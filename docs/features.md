# Spécifications fonctionnelles

> Chaque fonctionnalité porte un identifiant (`FN-xx`) pour la citer de façon stable.
> Les références au code citent le fichier et le symbole concerné, sans numéro de ligne.

## 1. Vue générale de l'interface

Barre supérieure (`renderer/index.html`), de gauche à droite :

| Élément | id | Fonction |
|---|---|---|
| Bouton « 📁 Open folder… » | `pickBtn` | Choix du dossier (FN-01) |
| Onglets **Photos** / **Videos** | `tabPhotos`, `tabVideos` | Changement de mode (FN-02) |
| Liste « Sort » | `sortBy` | Nom ou date de modification (FN-04) |
| Bouton ↑ / ↓ | `sortDir` | Sens du tri (FN-04) |
| Case « Subfolders » | `recursive` | Scan récursif (FN-05) |
| Case « Maximize » | `maximize` | Agrandissement en plein écran (FN-08) |
| « Types ▾ » | `typesBtn` | Extensions prises en compte (FN-03) |
| « ⚙ » | `prefsBtn` | Panneau Préférences (confirmation de suppression, fichiers cachés, liens symboliques) |
| « ⓘ » | `helpBtn` | Aide des raccourcis (FN-18) |

Sous la barre : chemin du dossier courant (`folderPath`, « No folder selected » au départ) et compteur (`count`, par exemple « 42 photos »). La grille (`grid`) occupe le reste de la fenêtre.

## 2. Ouverture et navigation dans les dossiers

### FN-01 Ouvrir un dossier
- Le bouton ouvre le sélecteur natif « dossier » (`main.js`).
- Annulation : aucun changement.
- Choix : le chemin devient le dossier de travail, la liste est rechargée, la sélection revient au premier élément (`renderer/renderer.js`).
- Le dossier n'est **pas** mémorisé entre les lancements (`state.folder` démarre à `null`).

### FN-02 Modes Photos et Videos
- Deux onglets. Le mode actif détermine les extensions proposées et le comportement de clic.
- Le changement de mode ferme la visionneuse, reconstruit le menu des types et recharge la liste (`renderer/renderer.js`).
- Le mode n'est pas mémorisé : l'application démarre toujours en **Photos** (`renderer/renderer.js`).

## 3. Types de fichiers

### FN-03 Extensions prises en charge
Définies dans `TYPE_SETS` (`renderer/renderer.js`) :

| Mode | Extensions par défaut | Extensions « autres types » (cochées à la demande) |
|---|---|---|
| Photos | `jpg`, `jpeg`, `png`, `webp` | `gif`, `bmp`, `avif` |
| Videos | `avi`, `mpg`, `mpeg`, `mkv` | `mp4`, `mov`, `m4v`, `webm`, `wmv`, `flv`, `3gp` |

- La correspondance est insensible à la casse (`main.js`).
- Le menu **Types ▾** propose une case par extension, en deux groupes : « Default » et « Other types ». Chaque changement enregistre les préférences et recharge la liste.
- Une extension décochée n'apparaît plus dans la liste ; décocher toutes les extensions donne une liste vide.
- Les formats photo listés sont **tous décodables par Chromium**. `tiff`, `tif` et `heic` ont été **retirés** (le 2026-10-17) car non décodables : ils ne sont plus ni proposés dans le menu, ni déclarés dans les associations de fichiers (`package.json`). Un `heic`/`tiff` déjà coché dans les préférences d'un utilisateur est nettoyé au chargement (`loadPrefs`).
- Le badge d'aperçu reste un filet de sécurité pour un fichier décochable mais illisible (corrompu, codec inattendu) ; voir FN-06 / FN-08.

## 4. Tri

### FN-04 Ordre de la liste
- Critères : **Name** (nom de fichier) ou **Date modified** (`mtimeMs`) ; sens ascendant (↑) ou descendant (↓).
- Le tri est effectué par le processus principal (`main.js`) :
  - nom : `localeCompare` avec `numeric: true`, donc `img2` précède `img10` ;
  - date : tri numérique sur `mtimeMs`, du plus ancien au plus récent en ascendant.
- **En mode sous-dossiers**, le tri par nom s'applique au **chemin relatif** (`rel`) et non au nom de fichier seul : les fichiers sont donc **regroupés par dossier** (ordre arborescent). En mode non récursif, le tri reste sur le nom de fichier. *(Depuis le 2026-10-17 ; auparavant, des homonymes de dossiers différents étaient mélangés.)*
- Le changement de critère ou de sens recharge la liste en **conservant la sélection** (fichiers toujours listés) et le curseur sur le même fichier (`loadList`, `renderer/renderer.js`). *(Depuis la 1.2.0 ; auparavant, la sélection revenait au premier élément.)* Seuls un nouveau dossier ou un changement de mode repartent du premier élément.
- Préférences sauvegardées : `sortBy`, `sortDir` (voir [config.md §3](config.md#3-préférences-persistées)).

### FN-05 Sous-dossiers
- Case **Subfolders** : scan récursif de toute l'arborescence (`main.js`).
- Quand la case est cochée, chaque vignette affiche le **chemin relatif** au dossier choisi (`renderer/renderer.js`) ; l'infobulle donne toujours le chemin complet (`renderer/renderer.js`).
- Les sous-dossiers illisibles (droits) sont ignorés sans erreur (`main.js`).
- **Fichiers cachés** (nom commençant par un point, fichiers **et** dossiers) : exclus par défaut. Une préférence **« Show hidden files »** permet de les inclure. *(Toggle ajouté le 2026-10-17 ; par défaut OFF.)*
- **Liens symboliques** : non suivis par défaut. Une préférence **« Follow symbolic links »** permet de les résoudre (vers fichiers et dossiers) ; les boucles sont évitées en ne visitant chaque dossier réel qu'une fois (`fs.realpath`). *(Toggle ajouté le 2026-10-17 ; par défaut OFF.)*
- Les deux réglages ci-dessus sont dans le panneau **⚙ Préférences** et rechargent la liste au changement ; voir [config.md §3](config.md#3-préférences-persistées).

## 5. Vignettes (grille)

### FN-06 Grille photo
- Chaque photo est affichée en vignette via une URL `file://` (`renderer/renderer.js`).
- Si Chromium ne peut pas afficher le fichier (corrompu ou codec inattendu — les formats non décodables comme tiff/heic ne sont plus proposés, voir FN-03), un badge affiche l'extension en majuscules. Le fichier reste listé et sélectionnable.
- Le libellé sous la vignette est le nom du fichier (ou le chemin relatif en mode sous-dossiers).

### FN-07 Vignettes vidéo : stop-motion
Chaque vidéo a une vignette animée (`renderer/renderer.js`, `main.js`).

**Échantillonnage** :
- Si la durée est **supérieure à 60 s** : échantillonnage **adaptatif** d'au plus **20 images** réparties sur **toute** la durée. L'intervalle vaut `max(60 s, durée / 20)` : une image toutes les 60 s pour les clips ≤ 20 min (cadence inchangée), puis un pas élargi au-delà (ex. 30 min → 90 s, 2 h → 6 min) pour couvrir ~95 % de la vidéo (`main.js`, constantes `FRAME_INTERVAL_SEC` / `MAX_FRAMES`). *(Depuis le 2026-10-17 ; auparavant, pas fixe de 60 s → seules les ~20 premières minutes étaient représentées.)*
- Si la durée est **inférieure ou égale à 60 s** ou **inconnue** : une seule image, prise à `min(1 s, durée/2)` ; sans durée connue, à 1 s (`main.js`). Il n'y a alors pas d'animation.
- Chaque image est extraite par un appel `ffmpeg` avec seek rapide avant l'entrée (`-ss t -i`), une seule frame, redimensionnée à 400 px de large (`main.js`).
- Si aucune image n'est obtenue, une tentative sans seek prend la première frame (`main.js`).

**Lecture** :
- La première image est affichée, puis les images défilent en boucle, **une par seconde** (`renderer/renderer.js`).
- Les vignettes sont calculées **au plus 2 à la fois** (`renderer/renderer.js`).
- Le badge « VIDEO » est affiché sur chaque vignette vidéo ; la classe `loading` est retirée à réception des images.
- Quand l'extraction **n'aboutit à aucune image** — qu'elle lève une erreur IPC **ou** qu'elle renvoie une liste vide (fichier corrompu, codec non géré par le ffmpeg embarqué, vidéo vide) — le badge devient **« NO PREVIEW »** et le spinner s'arrête, via le helper `markNoPreview` (`renderer/renderer.js`). *(Résolu le 2026-10-17 ; auparavant le cas « 0 image sans erreur » laissait la vignette en chargement indéfini.)*

**Cache** : les images extraites sont conservées sur disque ; voir [config.md §4](config.md#4-cache-des-images-vidéo). Une vidéo déjà en cache garde ses images (clé `chemin:mtime` inchangée) jusqu'à modification du fichier ou purge ; le nouvel échantillonnage ne s'applique donc qu'aux extractions suivantes.

## 6. Visionneuse plein écran (photos)

### FN-08 Affichage
- Ouverte par **double-clic** sur une vignette photo, ou par **Entrée** (`openCurrent`, `renderer/renderer.js`). *(Depuis la 1.2.0 ; le clic simple ouvrait directement, il sélectionne désormais, voir FN-21.)*
- Fond noir, image centrée, légende « nom · position/total » en bas (`renderer/renderer.js`).
- Un fichier que Chromium ne sait pas décoder (corrompu ou codec inattendu — les formats non décodables ne sont plus proposés, voir FN-03) ouvert en plein écran affiche une **notice centrée « Cannot preview · <EXT> »** (l'image cassée est masquée), en cohérence avec le badge d'extension de la grille. La notice disparaît dès qu'on navigue vers une image affichable (`renderer/renderer.js`, `showViewerError` / `hideViewerError`). *(Depuis le 2026-10-17 ; auparavant, seule une image cassée s'affichait, sans indication.)*
- Quitter : **Échap** ou clic sur le fond noir (pas sur l'image) (`renderer/renderer.js`).
- Ajustement (`applyFit`, `renderer/renderer.js`) :
  - par défaut, l'image est réduite pour tenir dans la fenêtre, **sans jamais dépasser sa taille native** ;
  - avec **Maximize** coché, elle est agrandie jusqu'à remplir la fenêtre en conservant les proportions ;
  - l'ajustement est recalculé au redimensionnement de la fenêtre et au changement de l'option.
- Le réglage Maximize est mémorisé (`renderer/renderer.js`).

### FN-09 Zoom et déplacement
- **Pincement** du pavé tactile (transmis comme `Ctrl` + molette) ou **molette** : zoom centré sur le curseur (`renderer/renderer.js`). Facteur : `exp(-deltaY × 0.01)` avec Ctrl, `exp(-deltaY × 0.0015)` sans Ctrl.
- Zoom minimal : 1 (ajustement). Zoom maximal : **8×** (`renderer/renderer.js`).
- **Glisser** pour déplacer l'image lorsqu'elle est zoomée (`renderer/renderer.js`).
- **Double-clic** ou touche **0** : retour à l'ajustement (`renderer/renderer.js`).
- Le zoom est réinitialisé à chaque changement d'image (`renderer/renderer.js`).

**Résolu (2026-10-17)** : un `mousedown` sur le fond de la visionneuse (`viewerEl`) remet `dragMoved` à `false` à chaque nouveau clic (`renderer/renderer.js`). Auparavant, `dragMoved` restait vrai après un glisser (réinitialisé seulement au `mousedown` sur l'image zoomée), si bien qu'un clic ultérieur sur le fond noir ne fermait plus la visionneuse ; Échap, lui, fonctionnait déjà.

### FN-10 Navigation dans la visionneuse
- **← / →** (aussi **↑ / ↓**) : photo précédente / suivante, la visionneuse se met à jour (`renderer/renderer.js`).
- Les flèches sont interceptées (`preventDefault`) : elles ne font pas défiler la page.

## 7. Lecture des vidéos

### FN-11 Lecture externe
- **Double-clic** sur une vignette vidéo, ou **Entrée**, ouvre le fichier dans le **lecteur par défaut du système** (`openCurrent` / `playCurrent`, `renderer/renderer.js`). *(Depuis la 1.2.0 ; auparavant, clic simple.)*
  - Linux : `xdg-open` avec un environnement assaini (`main.js`).
  - macOS : `shell.openPath` (`main.js`).
- En cas d'échec : message « Cannot open video: … ».
- Aucune lecture n'est intégrée à l'application.

## 8. Actions sur les fichiers

Les actions X, R, M et C portent sur la **sélection** en grille (FN-21) et sur la **seule photo affichée** dans la visionneuse (`actionTargets`, `renderer/renderer.js`). G, S, Entrée et le double-clic portent sur le fichier courant (curseur).

### FN-12 Mise à la corbeille (touche X)
- Par défaut, une **boîte de confirmation** « Send to trash? » s'ouvre : « “<nom>” will be moved to the trash (Z to undo). », ou « N files will be moved… » pour une sélection (Entrée confirme via le bouton focalisé, Échap annule). Ce garde-fou est **désactivable** dans ⚙ Préférences (« Confirm before deleting », défaut activé) ; désactivé, la touche X met à la corbeille immédiatement (`renderer/renderer.js`, `trashCurrent` / `openConfirmDelete` / `doTrash`, `confirmDelete`). Les fichiers visés sont figés à l'ouverture de la confirmation.
- **Annulable** (depuis la 1.2.0, FN-20) : le fichier n'est pas envoyé tout de suite à la corbeille système, il est déplacé par `rename` dans un dossier caché **du même dossier**, `.media-sorter-staging/` (instantané quelle que soit la taille). Toute la sélection forme **une seule** entrée d'annulation (`lib/undo.js`, `trashFiles`).
- Il rejoint la **corbeille du système** (paquet `trash` : corbeille du Finder sur macOS, corbeille freedesktop sur Linux), **sous son nom et à son emplacement d'origine** (« Remettre » fonctionne normalement), quand son entrée sort de la pile : 11ᵉ action, ou purge au lancement / en quittant (FN-20).
- **Repli** : si le dossier n'accepte pas le staging (lecture seule : `EACCES`, `EPERM`, `EROFS`), le fichier part directement à la corbeille système, **sans annulation possible** ; le message le signale (« (cannot be undone) »).
- Après succès : les éléments disparaissent de la liste, le compteur est mis à jour, un message « Trashed <nom> · Z to undo » (ou « Trashed N files · Z to undo ») s'affiche, et le curseur se place à la position du premier fichier supprimé (ou sur le dernier élément).
- S'il ne reste plus rien : la visionneuse se ferme.
- En cas d'échec : message « Trash failed: … », aucun changement dans la liste.
- Les frames en cache du fichier ne sont **pas** supprimées (voir [config.md §4](config.md#4-cache-des-images-vidéo)).

### FN-13 Renommage (touche R)
- Avec **plusieurs** fichiers sélectionnés, R ouvre le renommage en masse (FN-22).
- Une fenêtre modale « Rename file » s'ouvre, pré-remplie avec le nom complet. La partie avant le **dernier point** est présélectionnée, pour ne modifier que le nom de base (`renderer/renderer.js`).
- **Entrée** valide, **Échap** annule, ou boutons « Cancel » / « Rename ». Un clic à l'extérieur ne ferme pas la fenêtre.
- Règles appliquées par le processus principal (`main.js`) :
  - la saisie est nettoyée ; un nom vide provoque l'erreur « Empty name » ;
  - les séparateurs `/` et `\` sont remplacés par `_` (pas de déplacement involontaire) ;
  - **l'extension d'origine est toujours conservée** : elle est ajoutée sauf si le nom saisi se termine déjà par elle (comparaison insensible à la casse, puis casse normalisée sur l'extension d'origine). Le texte saisi est donc traité comme le **nom de base**, si bien qu'un point décoratif (`budget.2024` → `budget.2024.jpg`) n'écrase plus l'extension réelle. On ne peut donc plus changer l'extension via le renommage ; un fichier sans extension garde le nom tel quel. *(Depuis le 2026-10-17.)*
  - si le nom cible existe déjà, un suffixe ` (1)`, ` (2)`… est ajouté avant l'extension ;
  - un nom identique à l'original ne fait rien.
- Après succès : message « Renamed to <nouveau nom> · Z to undo », rechargement de la grille (les frames vidéo sont recalculées car la clé de cache dépend du chemin). Le renommage est **annulable** (FN-20).
- En cas d'échec : message « Rename failed: … ».

### FN-14 Éditeurs externes
| Touche | Mode | Application | macOS | Linux |
|---|---|---|---|---|
| **G** | Photos | GIMP | `open -a GIMP <fichier>` | binaire `gimp`, détaché |
| **S** | Vidéos | Shotcut | `open -a Shotcut <fichier>` | binaire `shotcut`, détaché |

- Définition : `EXTERNAL_APPS` (`main.js`).
- Succès : message « Opening in <app>… ».
- Application absente : message « Cannot open in <app>: … ».
- Les touches ne font rien dans le mode qui ne les concerne pas.
- Le README précise que les éditeurs doivent être installés ; ffmpeg, lui, est embarqué.

## 9. Ouverture depuis le système (Ouvrir avec)

### FN-15 Fichier passé à l'application
Les déclencheurs sont :
- **macOS** : l'événement `open-file` (`main.js`) ;
- **Linux / autres** : un argument de ligne de commande au lancement (`main.js`) ou une seconde instance (`main.js`) ;
- Les URI `file://` sont acceptées (`main.js`) : les gestionnaires de fichiers passent parfois une URI au lieu d'un chemin.

Comportement côté interface (`renderer/renderer.js`) :
0. si l'extension n'appartient **pas** à un type média connu (photo ou vidéo), l'ouverture est **refusée** avec un toast « Unsupported file type (.xyz) » et rien d'autre ne se produit (`isKnownExt`). *(Depuis le 2026-10-17 ; auparavant, une extension inconnue était classée en Photos et ajoutée **définitivement** aux types photo.)*
1. sinon, l'extension (média connue) est ajoutée aux types actifs du mode concerné si elle ne l'était pas, et les préférences sont sauvegardées ;
2. le mode correspondant (Photos ou Videos) est activé ;
3. le dossier parent devient le dossier de travail, et la liste est chargée ;
4. le fichier est sélectionné (par chemin complet, sinon par nom) ;
5. en Photos, la visionneuse s'ouvre ; en Videos, le fichier est sélectionné et visible, sans être lancé ;
6. si le fichier n'est pas trouvé dans la liste, le message « File not found in folder: … » s'affiche.

### FN-16 Instance unique
- Une seule fenêtre à la fois (`main.js`).
- Une seconde instance lancée avec un fichier transmet ce fichier à la fenêtre existante, qui est restaurée et mise au premier plan (`main.js`).
- Sous macOS, la fenêtre est recréée au clic sur l'icône si elle a été fermée (`main.js`).

## 10. Raccourcis clavier

### FN-17 Table des raccourcis

| Touche | Mode | Action | Réf. |
|---|---|---|---|
| **←** / **↑** | tous | Élément précédent (la sélection se réduit à lui) | `renderer/renderer.js` |
| **→** / **↓** | tous | Élément suivant (idem) | `renderer/renderer.js` |
| **Shift + flèches** | grille | Étendre la sélection en plage (FN-21) | `renderer/renderer.js` |
| **Cmd+A** / **Ctrl+A** | grille | Tout sélectionner (FN-21) | `renderer/renderer.js` |
| **Entrée** | Photos | Ouvrir la visionneuse (sans effet si déjà ouverte) | `renderer/renderer.js` |
| **Entrée** | Videos | Lancer dans le lecteur système | `renderer/renderer.js` |
| **Échap** | tous | Fermer la visionneuse ; en grille, réduire une sélection multiple au fichier courant | `renderer/renderer.js` |
| **0** | visionneuse | Réinitialiser le zoom | `renderer/renderer.js` |
| **X** | tous | Mettre à la corbeille (FN-12) | `renderer/renderer.js` |
| **Z**, **Cmd+Z**, **Ctrl+Z** | tous | Annuler la dernière action (FN-20) | `renderer/renderer.js` |
| **R** | tous | Renommer ; plusieurs fichiers : ajouter un préfixe (FN-22) | `renderer/renderer.js` |
| **M** | tous | Déplacer vers un dossier (FN-23) | `renderer/renderer.js` |
| **C** | tous | Copier vers un dossier (FN-23) | `renderer/renderer.js` |
| **G** | Photos | Ouvrir dans GIMP | `renderer/renderer.js` |
| **S** | Videos | Ouvrir dans Shotcut | `renderer/renderer.js` |

Souris (grille) : **clic** = sélectionner, **double-clic** = ouvrir, **Cmd/Ctrl + clic** = ajouter/retirer, **Shift + clic** = plage (FN-21).

Règles de garde (`renderer/renderer.js`) :
- Si l'**aide** est ouverte, seule **Échap** est traitée (elle la ferme).
- Si la **confirmation de suppression** est ouverte, seule **Échap** est traitée (annule) ; **Entrée** est gérée nativement par le bouton focalisé.
- Si le panneau **Préférences** est ouvert, seule **Échap** est traitée (le ferme).
- Si l'**overlay de progression** d'une copie est affiché, seule **Échap** est traitée (annule la copie, FN-23).
- Si la fenêtre de **renommage** ou d'**ajout de préfixe** est ouverte, le gestionnaire global ne fait rien (le champ gère ses propres touches).
- Si le focus est dans un champ `INPUT`, `SELECT` ou `TEXTAREA` (liste de tri, cases à cocher), les touches ne sont pas interceptées.

**Validé (2026-10-17)** : les touches **ne vérifient pas les modificateurs** (`Ctrl`, `Cmd`, `Alt`, `Fn`). `Cmd+X`, `Ctrl+R`, etc. déclenchent donc la même action que la touche seule. **Comportement souhaité** : il rend les raccourcis robustes quand les affectations de `Ctrl`/`Cmd`/`Option`/`Fn` diffèrent (machines virtuelles, macOS vs Linux natif), où exiger une combinaison exacte échouerait selon l'environnement. Exceptions depuis la 1.2.0 : **Cmd/Ctrl+A** (tout sélectionner, alors que A seul ne fait rien), **Shift + flèches** (plage), et **Cmd/Ctrl+Shift+Z**, ignoré faute de « refaire ».

**Focus après un réglage de la barre (résolu le 2026-10-17)** : après un changement de **Sort**, **Subfolders** ou **Maximize**, le contrôle rend le focus à la grille (`blur()`), pour que les flèches naviguent aussitôt dans les vignettes au lieu d'agir sur le contrôle. *(Auparavant, le focus restait sur le `<select>`/la case et les flèches étaient détournées jusqu'à un clic sur la grille.)*

Note : en mode grille, **Échap** réduit une sélection multiple au fichier courant (depuis la 1.2.0) ; en plein écran, il ferme la visionneuse.

## 11. Aide

### FN-18 Fenêtre des raccourcis
- Ouverte par le bouton **ⓘ** ; fermée par **Close**, **Échap** ou un clic à l'extérieur (`renderer/renderer.js`).
- Liste les raccourcis de la table FN-17, y compris les gestes de souris de la sélection (`renderer/index.html`).
- Pendant son ouverture, les autres touches sont ignorées.

## 12. Taille des vignettes

### FN-19 Pincement de la grille
- **Ctrl + molette** (pincement du pavé tactile) agrandit ou réduit les vignettes ; la molette seule fait défiler la grille (`renderer/renderer.js`).
- Facteur : `exp(-deltaY × 0.01)` sur la taille courante.
- Bornes : **110 px** minimum, **480 px** maximum (`renderer/renderer.js`).
- Taille par défaut : **200 px** (valeur de repli dans `styles.css`).
- La taille est mémorisée (`tileSize`, voir [config.md §3](config.md#3-préférences-persistées)).

## 13. Persistance et messages

- Messages temporaires (« toast ») : affichés 1,8 s en bas de l'écran (`renderer/renderer.js`).
- Préférences : voir [config.md §3](config.md#3-préférences-persistées).
- Aucune journalisation applicative n'est écrite sur disque.

## 14. Annulation, sélection multiple et actions groupées (1.2.0)

### FN-20 Annulation (Z, Cmd+Z, Ctrl+Z)
- **Pile des 10 dernières actions**, tenue par le processus principal (`lib/undo.js`, `createUndoStack`) et journalisée dans `<userData>/undo-journal.json` (écriture atomique) à chaque changement. Pas de « refaire ».
- Une entrée = une liste d'opérations typées ; une rafale (5 fichiers à la corbeille, 20 préfixes, 30 fichiers déplacés) est **une seule** entrée, annulée d'un coup :

  | Action | Annulation |
  |---|---|
  | Corbeille (FN-12) | le fichier sort du staging et revient à sa place |
  | Renommage (FN-13, FN-22) | le nom d'origine est rétabli |
  | Déplacement (FN-23) | retour dans le dossier source ; entre volumes, recopie avec progression et contrôle d'espace |
  | Copie (FN-23) | la copie part à la corbeille système (jamais de suppression définitive) |

- Les opérations sont rejouées en ordre inverse ; un échec ponctuel (fichier supprimé entre-temps) n'arrête pas les autres et est signalé. Si l'emplacement d'origine est occupé, le fichier revient avec un suffixe ` (n)`.
- Après annulation : la liste est rechargée et les fichiers restaurés sont **sélectionnés** ; message « Undone: <libellé> » (pile vide : « Nothing to undo »).
- Annuler un déplacement entre volumes est **refusé d'emblée** (entrée conservée) s'il n'y a pas la place ; si on l'interrompt (Cancel), les fichiers non revenus restent annulables.
- **Éviction** : à la 11ᵉ action, la plus ancienne sort de la pile ; ses fichiers en staging partent à la corbeille système.
- **Purge** : au lancement (reprise après crash, d'après le journal) et en quittant (`before-quit`, borné à 10 s), tous les fichiers en staging partent à la corbeille système ; l'historique ne survit donc pas à un redémarrage. Sous macOS, fermer la fenêtre sans quitter garde la pile. Seule l'instance principale purge.
- `fs:list` n'affiche jamais `.media-sorter-staging`, même avec les fichiers cachés visibles.

### FN-21 Sélection multiple
- État : `cursor` (fichier courant : visionneuse, Entrée, G/S), `sel` (ensemble de **chemins**) et `anchor` (origine des plages) (`renderer/renderer.js`).
- **Clic** : sélectionne ce seul fichier, **sans l'ouvrir**. **Double-clic** : ouvre (FN-08, FN-11).
- **Cmd/Ctrl + clic** : ajoute ou retire le fichier. **Shift + clic** et **Shift + flèches** : plage depuis l'ancre. **Cmd/Ctrl + A** : tout sélectionner. **Échap** : réduit au fichier courant. Les flèches seules réduisent la sélection au fichier atteint.
- Rendu : bordure bleue sur les fichiers sélectionnés ; contour blanc sur le curseur quand plusieurs fichiers sont sélectionnés ou qu'il est hors sélection. Compteur : « 42 photos · 5 selected ».
- La sélection survit au re-tri, au changement de types et à l'annulation (fichiers toujours listés) ; un nouveau dossier ou un changement de mode repart du premier fichier.
- En visionneuse, la sélection est ignorée : les actions portent sur la photo affichée.

### FN-22 Renommage en masse (préfixe)
- **R** avec plusieurs fichiers sélectionnés ouvre « Add a prefix to N files » (`prefixModal`) avec un aperçu « avant → après » des 10 premiers, mis à jour à la frappe. Le bouton est désactivé tant que le préfixe est vide.
- `file:renameBatch` (`main.js`) renomme chaque fichier en `<préfixe><nom>` dans son propre dossier, un par un ; les séparateurs `/` `\` du préfixe deviennent `_` ; une collision reçoit ` (n)` (l'aperçu ne l'anticipe pas, le message final compte les suffixes).
- Tout le lot est **une** entrée d'annulation. Message « Prefixed N files · Z to undo ».

### FN-23 Déplacement et copie (M, C)
- **M** (déplacer) ou **C** (copier) ouvre le sélecteur natif de dossier ; les fichiers visés sont la sélection (ou la photo affichée).
- `file:transfer` (`main.js`) :
  - déplacement sur le **même volume** : `rename`, instantané ;
  - **copie**, ou déplacement **entre volumes** : copie en flux avec progression (`lib/fileops.js`, `copyWithProgress` : fichier `.part` puis renommage, date de modification conservée), puis, pour un déplacement, vérification de taille et suppression de la source ;
  - **contrôle d'espace** avant de commencer : il faut les octets à copier plus une marge de max(200 Mo, 1 % du volume), sinon refus avec un message (« not enough space in … ») ;
  - collision de nom : suffixe ` (n)` ; déplacer un fichier vers son propre dossier est ignoré (« already there »).
- **Overlay de progression** (nom, n/N, octets, bouton Cancel ; Échap annule) affiché seulement quand des octets sont copiés. Une annulation abandonne le fichier en cours (source intacte, `.part` supprimé) ; les fichiers déjà traités le restent.
- Tout le lot (même partiel) est **une** entrée d'annulation. Après un déplacement, la liste est rechargée (les fichiers la quittent) ; après une copie, seulement si la destination est sous le dossier courant.
- Note : annuler une copie sur un volume externe l'envoie à la corbeille **de ce volume**, qui garde la place occupée jusqu'au vidage de la corbeille.

## 15. Comportements non couverts par le code

Ces points sont absents de l'application ; ils sont listés pour éviter toute ambiguïté :

- aucun classement assisté (dossiers favoris, destinations en un geste) : M et C passent par le sélecteur de dossier ;
- aucun « refaire » après une annulation, et pas d'historique d'annulation après un redémarrage ;
- aucun raccourci de lecture vidéo intégrée ;
- aucune recherche ni filtre par nom (hors extensions) ;
- aucune mémorisation du dossier ouvert ni de la position de la sélection.
