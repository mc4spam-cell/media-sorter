# Architecture technique

> Références au format `fichier:ligne` relatives à la racine du projet `/Users/mc/media-sorter`.
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

Il n'y a **ni framework front, ni bundler, ni base de données**. Le renderer est du JavaScript vanilla ; tout l'état vit dans un objet unique `state` (`renderer/renderer.js:22-36`).

## 2. Structure du dépôt

| Chemin | Rôle |
|---|---|
| `main.js` | Processus principal (435 lignes) |
| `preload.js` | Pont `window.api` (27 lignes) |
| `renderer/index.html` | Interface, CSP, modales |
| `renderer/renderer.js` | Logique d'interface (762 lignes) |
| `renderer/styles.css` | Styles (359 lignes) |
| `package.json` | Métadonnées, scripts, configuration `electron-builder` |
| `install-ubuntu.sh` | Script d'installation Ubuntu ([build-and-deploy.md](build-and-deploy.md#3-ubuntu--linux)) |
| `README.md`, `CHANGELOG.md` | Documentation utilisateur et journal des versions |
| `dist/` | Artefacts de build (ignoré par git, voir `.gitignore`) |
| `node_modules/` | Dépendances (ignoré par git) |
| `docs/` | Documentation de spécifications (ce dossier) |

Il n'existe pas de dossier de tests : aucun test automatisé n'est présent dans le dépôt.

## 3. Canaux IPC

Toutes les communications sont des `invoke` (requête/réponse) sauf deux événements poussés par le processus principal.

| Canal | Sens | Entrée | Sortie | Implémentation | Pont (preload) |
|---|---|---|---|---|---|
| `dialog:openFolder` | R → M | — | chemin ou `null` | `main.js:143-147` | `openFolder()` |
| `fs:list` | R → M | `folder`, `{exts, recursive, sortBy, sortDir}` | `[{name, path, mtimeMs, rel}]` | `main.js:150-186` | `list(folder, opts)` |
| `file:trash` | R → M | `filePath` | `true` | `main.js:189-193` | `trash(filePath)` |
| `file:rename` | R → M | `oldPath`, `newName` | nouveau chemin | `main.js:196-217` | `rename(oldPath, newName)` |
| `file:open` | R → M | `filePath` | `true` (erreur sinon) | `main.js:274-283` | `openExternal(filePath)` |
| `file:openWith` | R → M | `filePath`, `appKey` (`gimp`/`shotcut`) | `true` (erreur sinon) | `main.js:292-311` | `openWith(filePath, app)` |
| `video:frames` | R → M | `filePath`, `mtimeMs` | tableau de chemins de frames | `main.js:374-435` | `videoFrames(filePath, mtimeMs)` |
| `app:getPendingFile` | R → M | — | chemin ou `null` (consommé) | `main.js:136-140` | `getPendingFile()` |
| `open-file` | M → R (événement) | chemin | — | `main.js:89-95`, `99-103`, `111-118` | `onOpenFile(cb)` |

`toFileURL` (`preload.js:7-12`) est une fonction purement locale, exposée au renderer pour construire les URL `file://` des images.

## 4. Processus principal (`main.js`)

### 4.1 Fenêtre

- Une seule fenêtre `BrowserWindow` 1400 × 900, fond `#000000`, titre « Media Sorter » (`main.js:31-46`).
- `contextIsolation: true`, `nodeIntegration: false`, `preload` = `preload.js` (`main.js:37-41`).
- Barre de menu masquée (`main.js:45`).
- Zoom natif de la page désactivé après chargement (`setVisualZoomLevelLimits(1, 1)`, `main.js:49-51`) : le pinch-zoom est donc géré uniquement par l'application.

### 4.2 Cycle de vie

| Événement | Comportement | Référence |
|---|---|---|
| Instance unique | `requestSingleInstanceLock()` ; une seconde instance quitte, et son fichier éventuel est transmis à la première | `main.js:107-118` |
| `whenReady` | Récupère un fichier passé en argument (`fileArgFrom(process.argv)`), crée la fenêtre, recrée une fenêtre sur `activate` (macOS) | `main.js:120-128` |
| `open-file` (macOS) | Bufferise le fichier si la fenêtre n'existe pas encore | `main.js:99-103` |
| `window-all-closed` | Quitte sauf sous macOS | `main.js:131-133` |

### 4.3 Traitement des arguments « Ouvrir avec »

- `argToPath` (`main.js:60-70`) convertit une URI `file://` (avec ou sans hôte) en chemin POSIX décodé.
- `fileArgFrom` (`main.js:76-86`) retient le premier argument, hors exécutable et hors options `-…`, qui est un fichier existant.

### 4.4 Lancement d'applications externes

- Linux : `spawnDetached` lance le binaire avec `detached: true`, `stdio: 'ignore'`, puis `unref()` (`main.js:255-271`). L'environnement est assaini par `childEnv()` (`main.js:225-252`) : retrait des variables de chargement injectées par l'AppImage (`LD_LIBRARY_PATH`, `GTK_PATH`, `QT_PLUGIN_PATH`, etc.) et restauration des valeurs `*_ORIG`. Ce correctif est décrit dans le CHANGELOG 1.0.1.
- macOS : `open -a <App> <fichier>` (`main.js:296-307`).
- Ouverture par défaut : `xdg-open` sous Linux (assaini), `shell.openPath` ailleurs (`main.js:274-283`).

### 4.5 Extraction de frames vidéo

Détaillée dans [features.md, FN-07](features.md#5-vignettes-grille) et [config.md](config.md#2-constantes-de-code). Résumé : `probeDuration` lit la durée dans la bannière de `ffmpeg -i` (`main.js:350-365`), puis `runFfmpeg` extrait une image par point d'échantillonnage (`main.js:328-347`, `403-418`), avec mise en cache sur disque (`main.js:374-435`).

## 5. Preload (`preload.js`)

Le preload n'expose qu'un objet `api` figé par `contextBridge` (`preload.js:14-27`). Le renderer n'a donc accès ni à `ipcRenderer` ni à Node. Le commentaire de `preload.js:5-6` précise que le module `url` de Node n'est pas disponible dans le preload sandboxé, d'où la construction manuelle de l'URL.

Conséquence pour le renderer : il ne peut pas utiliser le module `path` ; `renderer/renderer.js:516-536` réimplémente `pathDir`, `pathBase` et `extOfName` pour `openPath`.

## 6. Renderer

### 6.1 Organisation de `renderer.js`

Le fichier est enveloppé dans une IIFE protégée contre une double évaluation (`window.__mediaSorterInit`, `renderer/renderer.js:6-11`). Sections, dans l'ordre :

| Section | Lignes | Contenu |
|---|---|---|
| Types de fichiers | 15-19 | `TYPE_SETS` : extensions par défaut et supplémentaires |
| État | 21-36 | objet `state` |
| Préférences | 38-74 | `savePrefs`, `loadPrefs`, `activeExts` |
| Chargement | 106-135 | `pickFolder`, `loadList` |
| Grille | 137-190 | `renderGrid` (reconstruit tout le DOM à chaque appel) |
| Vidéos | 192-244 | file d'attente (2 simultanés), stop-motion |
| Sélection | 246-265 | `setSelected`, `move` |
| Visionneuse | 267-311 | ouverture, fermeture, fichiers externes |
| Zoom / pan | 313-440 | zoom centré sur le curseur, pan, `applyFit` |
| Corbeille / renommage | 442-503 | `trashCurrent`, `openRename`, `confirmRename` |
| Onglets | 505-514 | `setKind` |
| Ouverture externe | 516-574 | `openPath` |
| Popover des types | 576-600 | `buildTypesPopover` |
| Événements | 602-655 | liaison des contrôles de la barre |
| Taille des vignettes | 657-688 | `setTile` |
| Clavier | 690-744 | gestionnaire global `keydown` |
| Initialisation | 746-761 | préférences, `getPendingFile`, `onOpenFile` |

### 6.2 Rendu de la grille

- `renderGrid` vide le conteneur et recrée une cellule par élément (`renderer/renderer.js:138-190`). Il n'y a **pas de virtualisation** : tous les fichiers listés sont dans le DOM. **[à confirmer]** : tenue en performance sur des dossiers de plusieurs milliers de fichiers.
- Toute action qui modifie la liste (renommage, suppression, changement de tri ou de types) déclenche un nouveau rendu complet.

### 6.3 Frames vidéo : file d'attente

`queueFrames` / `pump` limitent à **2** extractions concurrentes côté renderer (`renderer/renderer.js:194-212`). Chaque tâche vérifie que sa cellule est encore connectée au DOM avant de travailler (`renderer/renderer.js:216`), ce qui évite les travaux inutiles après un re-rendu.

### 6.4 Points de vigilance

- **Jeton de requête sur `loadList`** (`renderer/renderer.js`, `listSeq`) : chaque appel incrémente un compteur et ne met à jour `state.items` / la grille que si son jeton est toujours le plus récent au retour du `await`. Un listage lent qui résout après un appel plus récent est ainsi **ignoré**, ce qui évite qu'une réponse obsolète écrase la liste courante (changement de tri rapide, ou de dossier pendant un scan récursif long). L'appel est aussi protégé par un `try/catch` (toast « List failed » si non supplanté). *(Résolu le 2026-10-17.)*
- **Re-rendu complet après chaque action** : la suppression et le renommage appellent `renderGrid()` (`renderer/renderer.js:467`, `498`), ce qui relance toute la file des vignettes vidéo. Les frames sont en cache, mais chaque vignette repasse par l'IPC `video:frames`.
- **Pas de virtualisation** : la grille crée un élément DOM par fichier listé (voir §6.2).

## 7. Flux de données principaux

### 7.1 Listage d'un dossier

```
loadList()  (renderer)
  └─ api.list(folder, {exts, recursive, sortBy, sortDir})
       └─ ipc fs:list (main)
            ├─ walk(dir) : readdir withFileTypes, récursif si demandé
            ├─ filtre extension (minuscules), stat pour mtimeMs
            └─ tri (name localeCompare numeric | mtime) asc/desc
  └─ state.items = résultat ; selected = 0 ; renderGrid()
```

### 7.2 Vignette vidéo

```
renderGrid() → queueFrames(item, cell, img)
  └─ pump() → extractAndAnimate()
       └─ api.videoFrames(path, mtimeMs)
            └─ ipc video:frames (main)
                 ├─ cache présent avec .done ? → renvoie les frames
                 ├─ probeDuration (ffmpeg -i)
                 ├─ pour chaque timestamp : ffmpeg -ss t -i … -frames:v 1 -vf scale=400:-2
                 └─ fallback : première frame sans seek ; écrit .done si ≥ 1 frame
       └─ img.src = frame[0] ; setInterval 1 s pour la boucle
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
| `electron` | `^31.0.0` (dev) | 31.7.7 | Runtime desktop |
| `electron-builder` | `^24.13.3` (dev) | 24.13.3 | Génération des paquets |
| `ffmpeg-static` | `^5.2.0` | 5.3.0 | Binaire ffmpeg embarqué (chemin résolu dans `main.js:11-14`) |
| `trash` | `^7.2.0` | 7.2.0 | Mise à la corbeille, ESM chargé dynamiquement (`main.js:16-24`) |

Le paquet `trash` est chargé par `import()` dynamique car il est ESM uniquement (commentaire `main.js:16`).

## 9. Sécurité et isolation

| Mesure | Où | Remarque |
|---|---|---|
| Content-Security-Policy | `renderer/index.html:6-8` | `default-src 'self'` ; `img-src` et `media-src` autorisent `file:` et `data:` ; `script-src 'self'` (aucun script inline) ; `style-src 'self' 'unsafe-inline'` |
| `contextIsolation` | `main.js:39` | activé |
| `nodeIntegration` | `main.js:40` | désactivé |
| Sandbox du renderer | non déclaré | **[à confirmer]** : le commentaire de `preload.js:5` indique un preload sandboxé, cohérent avec le défaut d'Electron 31, mais le réglage n'est pas explicite |
| Lancement sans shell | `spawn(cmd, args)` dans `main.js:258`, `300`, `330`, `352` | Pas d'interpolation de chaîne dans un shell |
| Validation des chemins | aucune | **[à confirmer]** : les canaux `fs:list`, `file:trash`, `file:rename`, `file:open` acceptent tout chemin fourni par le renderer. Risque limité car le renderer ne charge que le fichier local `index.html`, mais il n'y a pas de restriction au dossier choisi |
| Renommage | `main.js:199-204` | Les séparateurs `/` et `\` sont remplacés par `_` |

## 10. Contraintes et particularités

- **Pas de test automatisé** dans le dépôt.
- **Électron `asar: false`** (`package.json`, section `build`) : `ffmpeg` et `trash` restent des exécutables directement accessibles. La branche `app.asar` de `main.js:12-13` est donc du code défensif.
- **Persistance** uniquement via `localStorage` du renderer (voir [config.md §3](config.md#3-préférences-persistées)) et le cache de frames sur disque.
- **Plateforme de build** : `ffmpeg-static` télécharge le binaire correspondant à la plateforme au moment de l'installation des dépendances (`node_modules/ffmpeg-static/install.js`). Un build doit donc être fait sur la plateforme cible ([build-and-deploy.md](build-and-deploy.md)).
