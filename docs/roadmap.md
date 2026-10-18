# Feuille de route : annulation, multi-sélection, renommage en masse, déplacement/copie

Plan d'implémentation pour la version **1.2.0**. Rédigé le 2026-10-18 à partir du code 1.1.0 (`main.js`, `preload.js`, `renderer/renderer.js`).

> **Statut : réalisé dans la 1.2.0** (phases 1 à 6, 2026-10-18). Le comportement livré fait foi dans [features.md](features.md) (FN-12, FN-13, FN-20 à FN-23) ; ce document garde la trace du plan et des décisions. Écarts : Échap réduit la sélection au lieu de la vider ; `freeBytes` est devenu `diskSpace` / `hasRoomFor`.

## 0. Vue d'ensemble

| Phase | Brique | Effort | Dépend de |
|---|---|---|---|
| 1 | Fondations : helpers fichiers partagés | ~0,25 j | — |
| 2 | Annulation : pile de 10, staging même volume, purge | ~0,5–1 j | 1 |
| 3 | Multi-sélection | ~1–1,5 j | — (branche X sur la pile composée de la phase 2) |
| 4 | Renommage en masse (préfixe) | ~0,5–1 j | 2, 3 |
| 5 | Déplacement / copie (minimal : un sélecteur de dossier par action) | ~0,5–1 j | 1, 2, 3 |
| 6 | Docs, changelog, release 1.2.0 (macOS + Ubuntu) | ~0,25 j | toutes |

Un commit par phase, chacun laisse l'application utilisable. Le **classement complet** (dossiers favoris, raccourcis vers destinations, etc., estimé +2–3 j) est **hors de ce plan** : la phase 5 se limite au sélecteur de dossier.

Deux fils rouges guident chaque phase :

- **Gros fichiers sur volumes externes.** Ce qui reste sur un même volume passe par `fs.rename` (instantané, aucun octet copié). Ce qui change de volume est une copie lente : flux avec progression, contrôle de l'espace disque, annulation possible.
- **Pile d'undo extensible dès le départ.** Une entrée = une liste d'opérations typées (`trash`, `rename`, `move`, `copy`). Une rafale (10 renommages, 30 fichiers déplacés) est **une seule** entrée parmi les 10.

---

## Phase 1 : fondations (`main.js`)

Helpers purs, réutilisés par toutes les phases suivantes :

| Helper | Rôle |
|---|---|
| `uniqueTarget(dir, name)` | Extrait de `file:rename` : renvoie un chemin libre, avec suffixe ` (n)` avant l'extension. `file:rename` est réécrit pour l'utiliser (comportement inchangé). |
| `sameVolume(a, b)` | Compare `stat.dev` du fichier source et du dossier destination. Sert d'indice ; la vérité reste l'erreur `EXDEV` de `fs.rename`. |
| `freeBytes(dir)` | `fs.promises.statfs(dir)` → `bavail * bsize` (dispo sous Electron 31 / Node 20). |
| `copyWithProgress(src, dst, { onProgress, signal })` | `pipeline(createReadStream, createWriteStream)` avec compteur d'octets, écrit dans `dst + '.part'` puis `rename` final ; **préserve `atime`/`mtime`** (`fs.utimes`), sinon le tri par date casserait après une copie ; supprime le `.part` en cas d'erreur ou d'annulation. |
| `moveFile(src, dst, opts)` | Tente `fs.rename` ; sur `EXDEV` : `copyWithProgress` puis vérification de taille puis `unlink(src)`. |

Validation : relancer l'app, renommer un fichier vers un nom existant → suffixe ` (1)` comme avant.

---

## Phase 2 : pile d'annulation (10 actions)

### 2.1 Principe

- La pile vit dans le **processus principal** (source de vérité) et est **journalisée** dans `userData/undo-journal.json` (écriture atomique : fichier temporaire puis `rename`) à chaque ajout, annulation ou éviction. Le renderer ne fait que demander `undo:pop` et afficher le résultat.
- **La touche X ne va plus directement à la corbeille système.** Le fichier est déplacé par `fs.rename` dans un dossier de staging **du même dossier** : `<dossier du fichier>/.media-sorter-staging/<id>__<nom>`. Même dossier, donc même volume, donc instantané quelle que soit la taille, sans aucune vérification de place nécessaire.
- Le fichier ne part réellement à la corbeille système (`trash`, comme aujourd'hui) que lorsque son entrée **sort de la pile** : éviction de la 11ᵉ entrée, ou purge.

### 2.2 Modèle d'entrée

```js
{ id, ts, label,            // label : « Corbeille : 3 fichiers », « Préfixe "2024_" : 12 fichiers »
  ops: [
    { type: 'trash',  original, staged },
    { type: 'rename', from, to },
    { type: 'move',   from, to, crossVolume },
    { type: 'copy',   to },
  ] }
```

| Type | Annulation | À l'éviction / purge |
|---|---|---|
| `trash` | `rename(staged → original)` | `trash(staged)` vers la corbeille système |
| `rename` | `rename(to → from)` | rien |
| `move` | même volume : `rename(to → from)` ; inter-volume : `moveFile` retour, avec contrôle d'espace et progression | rien |
| `copy` | `trash(to)` (la copie va à la corbeille système, jamais de suppression définitive) | rien |

Règles communes :
- L'annulation rejoue les `ops` **en ordre inverse** ; un échec ponctuel n'arrête pas les autres, le bilan est rapporté (« 11/12 restaurés, 1 introuvable »).
- Si le chemin d'origine est occupé entre-temps : restauration vers `uniqueTarget(...)` et toast.
- Si le fichier stagé ou déplacé a disparu (supprimé à la main) : l'op est ignorée et signalée.
- Pas de « refaire » (redo) dans ce plan.

### 2.3 Repli si le staging est impossible

Dossier en lecture seule ou `rename` refusé (`EACCES`, `EPERM`, `EROFS`) : envoi direct à la corbeille système **sans** entrée d'undo, toast « Mis à la corbeille (non annulable) ». Pas de copie de repli vers un autre volume.

### 2.4 Espace disque

- Le staging par `rename` **ne consomme aucun espace** et n'en libère pas non plus (comme la corbeille système, qui reste sur le même volume). Le contrôle d'espace ne sert donc pas au staging lui-même.
- Il s'applique à toute opération qui **copie des octets** : copie (phase 5), déplacement inter-volume (phase 5) et **annulation** d'un déplacement inter-volume. Règle : `freeBytes(dest) >= total + marge` (marge : max(200 Mo, 1 % du volume)). Échec → refus avant de commencer, message explicite (« 3,2 Go nécessaires, 1,1 Go libres sur /Volumes/USB »).

### 2.5 Purge

- **Au lancement** (`app.whenReady`, avant la création de fenêtre ou en parallèle, comme `pruneFrameCache`) : lecture du journal ; chaque `staged` encore présent part à la corbeille système ; les dossiers `.media-sorter-staging` vidés sont supprimés (`rmdir`, seulement s'ils sont vides) ; le journal est remis à zéro. C'est la reprise après crash.
- **À la fermeture** : `app.on('before-quit')` → `preventDefault()` une seule fois, purge asynchrone (garde-fou 10 s), puis `app.quit()`. Sur macOS, fermer la fenêtre sans quitter garde la pile (l'app tourne toujours) ; la purge a lieu au Cmd+Q.
- L'historique d'annulation **ne survit pas** à un redémarrage : c'est voulu.
- `fs:list` exclut explicitement `.media-sorter-staging`, y compris avec « fichiers cachés » activé et en mode récursif.

### 2.6 IPC et UI

| Canal | Rôle |
|---|---|
| `file:trash(paths[])` | Remplace l'actuel : staging de tous les chemins, **une** entrée composée. |
| `file:rename` | Inchangé côté appel ; pousse une entrée `rename`. |
| `undo:pop` | Annule la dernière entrée ; renvoie `{ label, restored: [chemins], errors }`. |
| `undo:peek` | Libellé de la prochaine annulation (pour le toast ou un futur bouton). |

- Raccourcis **Cmd+Z** (macOS) / **Ctrl+Z** (Linux), via `e.metaKey || e.ctrlKey` dans le `keydown` global (pas de menu, la barre est masquée), et **Z seul**, identique, dans la lignée des touches d'une lettre (X, R, G, S). Z n'est utilisé par aucun raccourci actuel ; comme les autres, il est ignoré quand une modale ou un champ a le focus.
- Après annulation : `loadList()` puis resélection du ou des fichiers restaurés s'ils sont dans la liste ; toast « Annulé : Corbeille (3 fichiers) ». Pile vide : toast « Rien à annuler ».

### 2.7 Validation

Corbeille d'un fichier puis Cmd+Z → revient à sa place, même `mtime`. Onze corbeilles → la première est dans la corbeille système. Quitter l'app avec des fichiers stagés → corbeille système, plus de `.media-sorter-staging`. Tuer le processus (`kill -9`) puis relancer → même résultat. Dossier en lecture seule → repli non annulable.

---

## Phase 3 : multi-sélection

### 3.1 Modèle d'état

`state.selected` (un index) est remplacé par :

| Champ | Rôle |
|---|---|
| `state.cursor` | Index du fichier courant (focus clavier, visionneuse, G/S, Entrée). |
| `state.sel` | `Set` de **chemins** (pas d'index : les index bougent à chaque corbeille, déplacement ou rechargement). |
| `state.anchor` | Index d'ancrage pour les plages Shift. |

Accesseurs : `selectOnly(i)`, `toggleSel(i)`, `selectRange(a, b)`, `selectAll()`, `clearSel()`, et surtout **`targets()`** : les éléments de `sel` dans l'ordre de la liste, ou `[items[cursor]]` si `sel` est vide. Toutes les actions passent par `targets()` ou `cursorItem()`.

Les chemins de `sel` sont mis à jour après un renommage, et filtrés après un rechargement (`loadList` garde ceux qui existent encore au lieu de remettre à zéro, sauf changement de dossier ou de mode).

### 3.2 Interactions

| Geste | Effet |
|---|---|
| Clic simple | **Change** : sélectionne ce seul fichier (curseur + ancre), **n'ouvre plus rien**. |
| Double-clic | Ouvre la visionneuse (photo) ou le lecteur (vidéo) : c'est l'ancien comportement du clic simple. |
| Cmd/Ctrl + clic | Bascule le fichier dans la sélection, déplace le curseur, n'ouvre rien. |
| Shift + clic | Sélectionne la plage ancre → fichier, n'ouvre rien. |
| Entrée | Inchangée : ouvre le fichier sous le curseur. |
| ← → ↑ ↓ | Déplacent le curseur et réduisent la sélection à ce seul fichier (comme aujourd'hui). |
| Shift + flèches | Étendent la plage depuis l'ancre. |
| Cmd/Ctrl + A | Tout sélectionner (grille uniquement). |
| Échap (grille) | Réduit la sélection au seul fichier courant (en visionneuse : ferme, comme aujourd'hui). Une sélection vide laisserait X agir sur un fichier non surligné. |

- Implémentation du double-clic : écouteur `dblclick` sur la cellule (le premier clic a déjà sélectionné le fichier, le second ouvre). Changement visible pour l'utilisateur, à signaler dans le CHANGELOG et la fenêtre des raccourcis.
- Rendu : classe `selected` pour l'appartenance à `sel`, classe `cursor` (contour distinct) pour le curseur. La mise à jour des classes se fait sans `renderGrid()` complet (on garde un tableau des cellules plutôt que `querySelectorAll` à chaque clic).
- Compteur : « 42 photos · 5 sélectionnées ».
- **Visionneuse** : n'agit que sur le curseur ; la sélection y est ignorée (X, R, G, S portent sur la photo affichée).

### 3.3 Branchement des actions

| Site actuel (`renderer.js`) | Après |
|---|---|
| `playCurrent`, `openWithApp`, `updateViewer`, erreur de `viewerImg` | `cursorItem()` |
| `trashCurrent` / `doTrash` | `targets()` → `api.trash(paths)` (une entrée d'undo) ; confirmation « 5 fichiers seront mis à la corbeille » |
| `openRename` / `confirmRename` | 1 cible : renommage actuel ; plusieurs : renommage en masse (phase 4) |
| `loadList`, `openPath` | initialisation de `cursor` / `sel` |

### 3.4 Validation

Clic simple (sélectionne sans ouvrir), double-clic (ouvre photo et vidéo), Shift-clic, Cmd-clic, Shift+flèches, Cmd+A, Échap ; X sur 5 fichiers puis Cmd+Z restaure les 5 d'un coup ; tri ou changement de types pendant une sélection → sélection conservée pour les fichiers encore listés ; mode récursif.

---

## Phase 4 : renommage en masse (préfixe)

- **Déclenchement** : R avec plus d'un fichier ciblé ouvre une modale « Ajouter un préfixe » (même mécanique `.hidden` que `renameModal`).
- **Aperçu** : la modale liste les 10 premiers « avant → après » en direct pendant la saisie, plus « … et N autres ». Calculé côté renderer à titre indicatif ; les noms finaux (avec suffixes de collision) viennent de main.
- **IPC** `file:renameBatch(paths, prefix)` : préfixe nettoyé (séparateurs `/` `\` remplacés, vide refusé) ; pour chaque fichier, `uniqueTarget(dir, prefix + name)` puis `rename`, séquentiellement (une collision créée par un fichier du même lot est donc vue par le suivant). Extension conservée de fait (le préfixe ne touche pas la fin du nom).
- **Undo** : une seule entrée composée de N ops `rename` ; Cmd+Z inverse tout le lot.
- Instantané même sur de gros fichiers (métadonnée seulement) : pas de barre de progression.
- **Validation** : 20 fichiers préfixés puis Cmd+Z ; préfixe qui crée une collision avec un fichier existant → ` (1)` ; mode récursif (fichiers dans plusieurs sous-dossiers) ; sélection et curseur suivent les nouveaux noms.

---

## Phase 5 : déplacement / copie (minimal)

### 5.1 Moteur (`main.js`)

- **IPC** `file:transfer(paths, destDir, mode)` avec `mode` = `'move'` ou `'copy'` ; événements `transfer:progress` (`{ fileIndex, fileCount, name, bytesDone, bytesTotal }`) poussés au renderer ; `file:transferCancel` pour interrompre.
- **Avant de commencer** : `assertRegularFile` sur chaque source ; somme des tailles à copier (copie : tout ; déplacement : seulement les fichiers sur un autre volume) ; contrôle `freeBytes(destDir)` (§2.4).
- **Déplacement** : `moveFile` (rename instantané sur le même volume, copie + suppression de la source sur un autre volume). **Copie** : toujours `copyWithProgress`.
- **Collisions** : `uniqueTarget(destDir, name)` → suffixe ` (n)`, sans question (cohérent avec le renommage actuel).
- Source déjà dans `destDir` : ignorée pour un déplacement ; pour une copie, elle produit ` (1)`.
- **Annulation en cours de route** : le fichier en cours est abandonné (son `.part` supprimé, sa source intacte) ; les fichiers déjà traités le restent et figurent dans l'entrée d'undo.
- **Undo** : une entrée composée (`move` ou `copy` par fichier), poussée à la fin, y compris pour un transfert partiel.

### 5.2 UI (`renderer`)

- Touches **M** (déplacer) et **C** (copier) sur `targets()`, en grille (et sur la photo courante en visionneuse) → sélecteur natif de dossier (`dialog:openFolder`, déjà présent).
- **Overlay de progression** : nom du fichier, « 3/12 », barre en octets, bouton Annuler. Affiché seulement si une copie d'octets a lieu (un déplacement même volume est instantané : simple toast).
- **Resynchro** : après un déplacement, `loadList()` (les fichiers sortent de la liste, ou restent si la destination est un sous-dossier et que le mode récursif est actif) ; curseur replacé au plus près de son ancienne position. Après une copie : rechargement seulement si la destination est sous le dossier courant.
- Toast bilan : « 12 fichiers déplacés vers Vacances ».

### 5.3 Validation

Sur un **second volume** : clé USB, ou image disque (`hdiutil create -size 2g -fs HFS+ -volname TestVol test.dmg` sur macOS ; image `ext4` montée en loop ou clé USB sur Ubuntu).
Déplacement même volume (instantané), déplacement inter-volume d'une vidéo de plusieurs Go (progression, `mtime` conservé), copie, collision, destination pleine (refus avant de commencer), annulation en cours, Cmd+Z après chaque cas (y compris l'annulation d'un déplacement inter-volume, qui refait une copie avec progression).

---

## Phase 6 : documentation et release 1.2.0

- `renderer/index.html` : fenêtre des raccourcis (FN-18) complétée (Z et Cmd/Ctrl+Z, Cmd/Ctrl+A, clic / double-clic, Shift/Cmd-clic, Shift+flèches, M, C, R multiple).
- `docs/features.md` : nouvelles fiches **FN-20** Annulation, **FN-21** Multi-sélection, **FN-22** Renommage en masse, **FN-23** Déplacement et copie ; mise à jour de FN-09 à FN-12 (corbeille via staging, renommage) et des fiches qui décrivent le clic sur une vignette (désormais : double-clic pour ouvrir).
- `docs/architecture.md` (nouveaux canaux IPC, journal d'undo), `docs/config.md` (`undo-journal.json`, `.media-sorter-staging`, constantes : taille de pile 10, marge d'espace, délai de purge).
- `docs/README.md` : retirer « Déplacement, copie et classement » et « Annulation des actions » du hors-périmètre ; y laisser le classement complet.
- `README.md`, `CHANGELOG.md` (1.2.0), version dans `package.json`.
- **Parité stricte** : même commit, `.dmg` x64 et arm64 sur les Mac, `.deb` construit **sur Ubuntu** ; tester l'app installée des deux côtés (corbeille Linux sur volume externe = `.Trash-<uid>` du volume, gérée par `trash`).

---

## Décisions retenues (validées le 2026-10-18)

1. **Staging dans le dossier même du fichier** (`.media-sorter-staging`), plutôt qu'à la racine du volume : garantit le même volume et des droits d'écriture identiques, au prix de dossiers cachés éparpillés (nettoyés à la purge).
2. **Clic simple = sélection, double-clic = ouvrir** (comportement standard d'un gestionnaire de fichiers) ; Cmd/Ctrl-clic et Shift-clic pour la sélection multiple. Change l'usage actuel (le clic ouvrait directement).
3. **Collisions résolues automatiquement** par ` (n)`, sans demander.
4. **Pas de refaire (redo)**, pas d'historique conservé après un redémarrage. Annulation par **Z** ou **Cmd/Ctrl+Z**.
5. **Annuler une copie** envoie la copie à la corbeille système (jamais de suppression définitive).
