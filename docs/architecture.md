# Architecture technique

> Références au code : fichier et symbole (fonction, constante), sans numéro de ligne ; chemins relatifs à la racine du projet.
> Voir aussi [overview.md](overview.md), [features.md](features.md), [config.md](config.md).

## 1. Vue d'ensemble

Application Electron classique en trois couches :

```
┌──────────────────────────── Processus principal (Node.js) ───────────────────────────┐
│ main.js                                                                             │
│  • fenêtre, cycle de vie, instance unique, « Ouvrir avec »                          │
│  • système de fichiers : listage, renommage, corbeille                              │
│  • lancement d'applications externes (xdg-open, open -a, GIMP, Shotcut)            │
│  • extraction de frames vidéo via ffmpeg (ffmpeg-static)                            │
└───────────────▲──────────────────────────────────────────────────────────────────────┘
                │ ipcMain.handle / ipcRenderer.invoke   (canaux listés §3)
                │ webContents.send('open-file')          (push vers le renderer)
┌───────────────┴──── Preload (sandbox, contextIsolation) ──────────────────────────────┐
│ preload.js                                                                           │
│  • contextBridge.exposeInMainWorld('api', {...})  → seul pont vers le renderer      │
│  • toFileURL(p) : construit une URL file:// encodée                                  │
└───────────────▲──────────────────────────────────────────────────────────────────────┘
                │ window.api
┌───────────────┴──────────── Renderer (Chromium, sans Node) ──────────────────────────┐
│ renderer/index.html  (structure, CSP, modales)                                       │
│ renderer/renderer.js (état global, grille, visionneuse, clavier, préférences)        │
│ renderer/styles.css  (thème sombre, grille dimensionnée par --tile)                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Il n'y a **ni framework front, ni bundler, ni base de données**. Le renderer est du JavaScript vanilla ; tout l'état vit dans un objet unique `state` (`renderer/renderer.js`).

## 2. Structure du dépôt

| Chemin | Rôle |
|---|---|
| `main.js` | Processus principal (~800 lignes) |
| `lib/fileops.js` | Helpers fichiers sans dépendance Electron : `uniqueTarget`, `sameVolume`, `diskSpace` / `hasRoomFor`, `copyWithProgress`, `moveFile` (depuis la 1.2.0) |
| `lib/undo.js` | Pile d'annulation journalisée et staging de la corbeille (depuis la 1.2.0) |
| `lib/rotate.js` | Rotation de 90° sans perte : orientation EXIF des JPEG, pixels via ffmpeg pour PNG/BMP/WebP (depuis la 1.2.1) |
| `preload.js` | Pont `window.api` (~35 lignes) |
| `renderer/index.html` | Interface, CSP, modales |
| `renderer/renderer.js` | Logique d'interface (~1300 lignes) |
| `renderer/styles.css` | Styles (~500 lignes) |
| `package.json` | Métadonnées, scripts, configuration `electron-builder` |
| `install-ubuntu.sh` | Script d'installation Ubuntu ([build-and-deploy.md](build-and-deploy.md#3-ubuntu--linux)) |
| `README.md`, `CHANGELOG.md` | Documentation utilisateur et journal des versions |
| `dist/` | Artefacts de build (ignoré par git, voir `.gitignore`) |
| `node_modules/` | Dépendances (ignoré par git) |
| `docs/` | Documentation de spécifications (ce dossier) |

Il n'existe pas de dossier de tests : aucun test automatisé n'est présent dans le dépôt.

## 3. Canaux IPC

Toutes les communications sont des `invoke` (requête/réponse), sauf les événements poussés par le processus principal (`open-file`, `transfer:progress`, `transfer:end`, `shortcut`) et le message à sens unique `ui:textEditing` (`send`, renderer → main).

| Canal | Sens | Entrée | Sortie | Implémentation | Pont (preload) |
|---|---|---|---|---|---|
| `dialog:openFolder` | R → M | — | chemin ou `null` | `main.js` | `openFolder()` |
| `fs:list` | R → M | `folder`, `{exts, recursive, sortBy, sortDir, showHidden, followSymlinks}` | `[{name, path, mtimeMs, rel}]` | `main.js` | `list(folder, opts)` |
| `file:trash` | R → M | `paths[]` | `{trashed, fallback, errors}` ; une entrée d'annulation | `main.js`, `lib/undo.js` | `trash(paths)` |
| `file:rename` | R → M | `oldPath`, `newName` | nouveau chemin ; une entrée d'annulation | `main.js` | `rename(oldPath, newName)` |
| `file:renameBatch` | R → M | `paths[]`, `prefix` | `{renamed: [{from, to}], errors}` ; une entrée | `main.js` | `renameBatch(paths, prefix)` |
| `file:transfer` | R → M | `paths[]`, `destDir`, `'move'`/`'copy'` | `{done: [{from, to}], skipped, errors, cancelled}` ; une entrée | `main.js` | `transfer(paths, destDir, mode)` |
| `file:rotate` | R → M | `paths[]`, `'cw'`/`'ccw'` | `{rotated: [path], errors}` ; une entrée | `main.js`, `lib/rotate.js` | `rotate(paths, dir)` |
| `file:transferCancel` | R → M | — | — (interrompt la copie en cours) | `main.js` | `cancelTransfer()` |
| `transfer:progress` | M → R (événement) | `{name, fileIndex, fileCount, bytesDone, bytesTotal}` | — | `main.js` | `onTransferProgress(cb)` |
| `transfer:end` | M → R (événement) | — | — | `main.js` | `onTransferEnd(cb)` |
| `undo:pop` | R → M | — | `{label, restored, errors, cancelled}` ou `null` | `lib/undo.js` | `undo()` |
| `shortcut` | M → R (événement) | `{key, shift}` : combinaison Cmd/Ctrl captée avant le menu, à traiter comme la touche seule | — | `main.js` | `onShortcut(cb)` |
| `ui:textEditing` | R → M (`send`) | `true` si un champ texte a le focus | — | `main.js` | `setTextEditing(on)` |
| `undo:peek` | R → M | — | libellé de la prochaine annulation ou `null` | `lib/undo.js` | `peekUndo()` |
| `file:open` | R → M | `filePath` | `true` (erreur sinon) | `main.js` | `openExternal(filePath)` |
| `file:openWith` | R → M | `filePath`, `appKey` (`gimp`/`shotcut`) | `true` (erreur sinon) | `main.js` | `openWith(filePath, app)` |
| `video:frames` | R → M | `filePath`, `mtimeMs` | tableau de chemins de frames | `main.js` | `videoFrames(filePath, mtimeMs)` |
| `app:getPendingFile` | R → M | — | chemin ou `null` (consommé) | `main.js` | `getPendingFile()` |
| `open-file` | M → R (événement) | chemin | — | `main.js` | `onOpenFile(cb)` |

`toFileURL` (`preload.js`) est une fonction purement locale, exposée au renderer pour construire les URL `file://` des images.

## 4. Processus principal (`main.js`)

### 4.1 Fenêtre

- Une seule fenêtre `BrowserWindow` 1400 × 900, fond `#000000`, titre « Media Sorter » (`main.js`).
- `contextIsolation: true`, `nodeIntegration: false`, `preload` = `preload.js` (`main.js`).
- Barre de menu masquée (`main.js`).
- **Raccourcis Cmd/Ctrl** : `before-input-event` capte, avant le menu d'application par défaut, les combinaisons Cmd/Ctrl sur les touches de l'app (`FORWARDED_SHORTCUTS`) et les renvoie au renderer comme la touche seule (événement `shortcut`), sauf quand un champ texte a le focus (`ui:textEditing`). Voir [features.md, FN-17](features.md#fn-17-table-des-raccourcis). Toute nouvelle touche de raccourci doit être ajoutée à `FORWARDED_SHORTCUTS`.
- Zoom natif de la page désactivé après chargement (`setVisualZoomLevelLimits(1, 1)`, `main.js`) : le pinch-zoom est donc géré uniquement par l'application.

### 4.2 Cycle de vie

| Événement | Comportement | Référence |
|---|---|---|
| Instance unique | `requestSingleInstanceLock()` ; une seconde instance quitte, et son fichier éventuel est transmis à la première | `main.js` |
| `whenReady` | Récupère un fichier passé en argument (`fileArgFrom(process.argv)`), crée la pile d'annulation et lance sa **purge** (reprise après crash), crée la fenêtre, recrée une fenêtre sur `activate` (macOS) | `main.js` |
| `open-file` (macOS) | Bufferise le fichier si la fenêtre n'existe pas encore | `main.js` |
| `before-quit` | Retient la fermeture une fois, purge le staging d'annulation (borné à 10 s, `PURGE_TIMEOUT_MS`), puis quitte. Instance principale seulement | `main.js` |
| `window-all-closed` | Quitte sauf sous macOS | `main.js` |

### 4.3 Traitement des arguments « Ouvrir avec »

- `argToPath` (`main.js`) convertit une URI `file://` (avec ou sans hôte) en chemin POSIX décodé.
- `fileArgFrom` (`main.js`) retient le premier argument, hors exécutable et hors options `-…`, qui est un fichier existant.

### 4.4 Lancement d'applications externes

- Linux : `spawnDetached` lance le binaire avec `detached: true`, `stdio: 'ignore'`, puis `unref()` (`main.js`). L'environnement est assaini par `childEnv()` (`main.js`) : retrait des variables de chargement injectées par l'AppImage (`LD_LIBRARY_PATH`, `GTK_PATH`, `QT_PLUGIN_PATH`, etc.) et restauration des valeurs `*_ORIG`. Ce correctif est décrit dans le CHANGELOG 1.0.1.
- macOS : `open -a <App> <fichier>` (`main.js`).
- Ouverture par défaut : `xdg-open` sous Linux (assaini), `shell.openPath` ailleurs (`main.js`).

### 4.5 Extraction de frames vidéo

Détaillée dans [features.md, FN-07](features.md#5-vignettes-grille) et [config.md](config.md#2-constantes-de-code). Résumé : `probeDuration` lit la durée dans la bannière de `ffmpeg -i` (`main.js`), puis `runFfmpeg` extrait une image par point d'échantillonnage (`main.js`), avec mise en cache sur disque (`main.js`).

### 4.6 Pile d'annulation et transferts (1.2.0)

- `lib/undo.js` (`createUndoStack`) possède la pile (10 entrées) ; toutes ses opérations (corbeille, enregistrement, annulation, purge) sont **sérialisées** par une chaîne de promesses, et chaque changement réécrit `undo-journal.json`. Pour la corbeille, l'intention est journalisée **avant** de déplacer les fichiers : après un crash, la purge sait où est chaque fichier en staging. Le comportement fonctionnel est décrit en [features.md, FN-20](features.md#fn-20-annulation-z).
- Les types d'opération (`trash`, `rename`, `move`, `copy`, `rotate`) ont chacun un gestionnaire d'annulation (`UNDO`) ; un nouveau type s'y branche sans toucher au reste.
- `beginTransfer` (`main.js`) encadre toute copie d'octets : un seul transfert à la fois, `AbortController` pour Cancel, progression globale poussée au renderer (au plus toutes les 100 ms, `PROGRESS_INTERVAL_MS`). Il sert à `file:transfer` et à l'annulation d'un déplacement entre volumes (passé à `createUndoStack`).
- `lib/` n'a aucune dépendance Electron : ses modules s'exercent avec Node seul. Le dossier doit rester dans `build.files` (`package.json`).

## 5. Preload (`preload.js`)

Le preload n'expose qu'un objet `api` figé par `contextBridge` (`preload.js`). Le renderer n'a donc accès ni à `ipcRenderer` ni à Node. Le commentaire de `preload.js` précise que le module `url` de Node n'est pas disponible dans le preload sandboxé, d'où la construction manuelle de l'URL.

Conséquence pour le renderer : il ne peut pas utiliser le module `path` ; `renderer/renderer.js` réimplémente `pathDir`, `pathBase` et `extOfName` pour `openPath`.

## 6. Renderer

### 6.1 Organisation de `renderer.js`

Le fichier est enveloppé dans une IIFE protégée contre une double évaluation (`window.__mediaSorterInit`, `renderer/renderer.js`). Sections (commentaires `// ---------- … ----------`), dans l'ordre :

| Section | Contenu |
|---|---|
| Types de fichiers | `TYPE_SETS` : extensions par défaut et supplémentaires |
| État | objet `state` (dont `cursor`, `sel`, `anchor`) |
| Préférences | `savePrefs`, `loadPrefs`, `activeExts` |
| Helpers | `errMsg`, `toast`, timers, `isModalOpen` |
| Chargement | `pickFolder`, `loadList` (option `reset`), `updateCount` |
| Grille | `renderGrid` (reconstruit tout le DOM à chaque appel ; clic / double-clic) |
| Vidéos | file d'attente (2 simultanés), stop-motion |
| Sélection | `cursorItem`, `selectedItems`, `actionTargets`, `select`, `selectPaths`, `selectAll`, `paintSelection`, `move` |
| Visionneuse | `openCurrent`, ouverture, fermeture, fichiers externes |
| Zoom / pan | zoom centré sur le curseur, pan, `applyFit` |
| Corbeille | `trashCurrent`, `doTrash` |
| Annulation | `undoLast` |
| Renommage | `openRename`, `confirmRename` |
| Renommage en masse | `openPrefix`, `updatePrefixPreview`, `confirmPrefix` |
| Rotation | `photoSrc`, `bumpRevs`, `rotateTargets`, `doRotate` |
| Déplacement / copie | `transferTo`, overlay de progression |
| Onglets | `setKind` |
| Ouverture externe | `openPath` |
| Popover des types | `buildTypesPopover` |
| Événements, préférences, confirmation | liaison des contrôles et des modales |
| Taille des vignettes | `setTile` |
| Clavier | gestionnaire global `keydown` |
| Initialisation | préférences, `getPendingFile`, `onOpenFile` |

### 6.2 Rendu de la grille

- `renderGrid` vide le conteneur et recrée une cellule par élément (`renderer/renderer.js`). Il n'y a **pas de virtualisation du DOM** : tous les fichiers listés sont dans le DOM (choix assumé ; la virtualisation reste une évolution possible si le nombre de nœuds devient limitant). En revanche, le **travail coûteux est différé au viewport** (le 2026-10-17) :
  - **Photos** : `<img loading="lazy">` — les images hors écran ne sont pas décodées tant qu'elles n'approchent pas du viewport.
  - **Vidéos** : un `IntersectionObserver` (root = la grille, `rootMargin` 400 px) ne lance l'**extraction** ffmpeg **et** l'**animation** stop-motion que pour les tuiles proches de l'écran, et **met en pause le timer** d'une tuile qui sort de l'écran (reprise à son retour, frames déjà en cache). Un dossier de centaines de vidéos n'extrait donc plus tout d'un coup et ne fait plus tourner des centaines de timers permanents.
- Toute action qui modifie la liste (renommage, suppression, changement de tri ou de types) déclenche un nouveau rendu complet (`resetGrid` reconnecte l'observer et stoppe les timers précédents).

### 6.3 Frames vidéo : file d'attente

`queueExtract` / `pump` limitent à **2** extractions concurrentes côté renderer. L'extraction n'est mise en file que lorsqu'une tuile vidéo entre dans la zone de l'observer (voir §6.2). Chaque tâche vérifie que sa cellule est encore connectée au DOM avant et après l'`await` (`renderer/renderer.js`), ce qui évite tout travail ou écriture DOM après un re-rendu.

### 6.4 Points de vigilance

- **Jeton de requête sur `loadList`** (`renderer/renderer.js`, `listSeq`) : chaque appel incrémente un compteur et ne met à jour `state.items` / la grille que si son jeton est toujours le plus récent au retour du `await`. Un listage lent qui résout après un appel plus récent est ainsi **ignoré**, ce qui évite qu'une réponse obsolète écrase la liste courante (changement de tri rapide, ou de dossier pendant un scan récursif long). L'appel est aussi protégé par un `try/catch` (toast « List failed » si non supplanté). *(Résolu le 2026-10-17.)*
- **Sélection sans re-rendu** : un clic ou une flèche ne fait que basculer les classes `selected` / `cursor` via le tableau `cells` (`paintSelection`), sans reconstruire la grille.
- **Re-rendu complet après chaque action** : la suppression et le renommage appellent `renderGrid()`, qui réinitialise l'observer. Seules les tuiles vidéo re-rendues et visibles relancent l'IPC `video:frames` (frames en cache) — plus toute la liste.
- **Pas de virtualisation du DOM** : la grille crée un élément DOM par fichier listé (voir §6.2). Le coût images/CPU est désormais borné par le lazy-loading et l'observer ; le nombre de **nœuds** reste proportionnel à la taille du dossier (évolution « virtualisation » documentée comme option si nécessaire).

## 7. Flux de données principaux

### 7.1 Listage d'un dossier

```
loadList()  (renderer)
  └─ api.list(folder, {exts, recursive, sortBy, sortDir})
       └─ ipc fs:list (main)
            ├─ walk(dir) : readdir withFileTypes, récursif si demandé
            ├─ filtre extension (minuscules), stat pour mtimeMs
            └─ tri (name localeCompare numeric | mtime) asc/desc
  └─ state.items = résultat ; nouveau dossier/mode : cursor = 0, sel = {premier} ; sinon sélection et curseur conservés ; renderGrid()
```

### 7.2 Vignette vidéo

```
renderGrid() → gridObserver.observe(cell)   (cellule vidéo)
  └─ onIntersect : la tuile approche du viewport → queueExtract(st)
       └─ pump() → extractFrames(st)          (max 2 en parallèle)
            └─ api.videoFrames(path, mtimeMs)
                 └─ ipc video:frames (main)
                      ├─ cache présent avec .done ? → renvoie les frames (bump mtime)
                      ├─ probeDuration (ffmpeg -i)
                      ├─ pour chaque timestamp : ffmpeg -ss t -i … -frames:v 1 -vf scale=400:-2
                      └─ fallback : première frame sans seek ; écrit .done si ≥ 1 frame
       └─ img.src = frame[0] ; si visible et > 1 frame : startAnimation (setInterval 1 s)
  └─ onIntersect (sortie d'écran) : stopCell(st) met le timer en pause
```

### 7.3 Ouverture d'un fichier « Ouvrir avec »

```
Système → main : open-file (macOS)  |  second-instance argv  |  argv au lancement
  └─ pendingFile (si pas de fenêtre) ou webContents.send('open-file', path)
renderer : getPendingFile() au démarrage ; onOpenFile() ensuite
  └─ openPath(path) : active l'extension si besoin, bascule le mode,
     charge le dossier parent, sélectionne le fichier, ouvre la visionneuse (photo)
```

## 8. Dépendances clés

| Paquet | Spécification (`package.json`) | Version installée | Rôle |
|---|---|---|---|
| `electron` | `^44.9.0` (dev) | 44.9.0 | Runtime desktop (Chromium 152) |
| `electron-builder` | `^26.17.0` (dev) | 26.17.0 | Génération des paquets |
| `ffmpeg-static` | `^5.2.0` | 5.3.0 | Binaire ffmpeg embarqué (chemin résolu dans `main.js`) |
| `trash` | `^9.0.0` | 9.0.0 | Mise à la corbeille, ESM chargé dynamiquement (`main.js`) |

Le paquet `trash` est chargé par `import()` dynamique car il est ESM uniquement (commentaire `main.js`). Son export par défaut accepte un chemin ou un tableau (`lib/undo.js` lui passe des tableaux). Depuis `trash` 8.1, le binaire `macos-trash` est universel (x86_64 + arm64) : il tourne nativement sur Apple Silicon.

**Montée de version (non publiée, voir `CHANGELOG.md` [Unreleased])** : la 1.2.0 a été livrée sur Electron 31.7.7 / electron-builder 24.13.3 / trash 7.2.0. Le passage à Electron 44 / electron-builder 26 / trash 9 implique :

- **Node ≥ 22.12** pour installer et construire (`engines` du paquet `electron` et de `@electron/rebuild`) ; `package.json` le déclare dans `engines`, `install-ubuntu.sh` installe Node 22.x.
- **macOS 13 minimum** (Electron 44 ; 31 acceptait 10.15). `LSMinimumSystemVersion` du bundle vaut `13.0`.
- Le paquet `electron` ne télécharge plus son binaire au `postinstall` (Electron 42) : il le fait au premier lancement (`npx electron .` / `npm start`), ou à l'empaquetage.
- Les boîtes de dialogue sans `defaultPath` s'ouvrent dans Téléchargements (Electron 43). `dialog:openFolder` (`main.js`) part donc du dernier dossier choisi dans la session, sinon du dossier parcouru (passé par le renderer).
- Linux : Wayland natif par défaut sur une session Wayland (Electron 38), GTK 4 par défaut sous GNOME (Electron 36).

## 9. Sécurité et isolation

| Mesure | Où | Remarque |
|---|---|---|
| Content-Security-Policy | `renderer/index.html` | `default-src 'self'` ; `img-src` et `media-src` autorisent `file:` et `data:` ; `script-src 'self'` (aucun script inline) ; `style-src 'self' 'unsafe-inline'` |
| `contextIsolation` | `main.js` | activé |
| `nodeIntegration` | `main.js` | désactivé |
| Sandbox du renderer | **`sandbox: true` explicite** | Déclaré dans les `webPreferences` (`main.js`, ajouté le 2026-10-17) au lieu de dépendre du défaut d'Electron, pour verrouiller la posture à travers les futures montées de version. Le preload n'utilise que `contextBridge`/`ipcRenderer`, compatibles sandbox (`preload.js`). |
| Lancement sans shell | `spawn(cmd, args)` dans `main.js` | Pas d'interpolation de chaîne dans un shell |
| Validation des chemins | partielle (type de cible) | `file:trash`, `file:rename`, `file:renameBatch`, `file:rotate`, `file:transfer`, `file:open`, `file:openWith` valident désormais que la cible est un **fichier régulier existant** (`assertRegularFile`) avant d'agir — durcissement défensif ajouté le 2026-10-17. Il n'y a pas (volontairement) de restriction au dossier choisi : le flux « Ouvrir avec » et le multi-dossiers l'exigent. Le renderer reste local et de confiance (CSP `script-src 'self'`, aucune entrée distante), donc le risque restait théorique. |
| Renommage | `main.js` | Les séparateurs `/` et `\` sont remplacés par `_` |

## 10. Contraintes et particularités

- **Pas de test automatisé** dans le dépôt.
- **Électron `asar: false`** (`package.json`, section `build`) : `ffmpeg` et `trash` restent des exécutables directement accessibles. La branche `app.asar` de `main.js` est donc du code défensif.
- **Persistance** uniquement via `localStorage` du renderer (voir [config.md §3](config.md#3-préférences-persistées)), le cache de frames sur disque et le journal d'annulation `<userData>/undo-journal.json` (vidé à chaque purge, voir [config.md §5](config.md#5-chemins-système)).
- **Plateforme de build** : `ffmpeg-static` télécharge le binaire correspondant à la plateforme au moment de l'installation des dépendances (`node_modules/ffmpeg-static/install.js`). Un build doit donc être fait sur la plateforme cible ([build-and-deploy.md](build-and-deploy.md)).
