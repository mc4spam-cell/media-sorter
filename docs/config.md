# Configuration, formats et chemins

> Références au code : fichier et symbole (fonction, constante), sans numéro de ligne ; chemins relatifs à la racine du projet.
> L'application n'a **aucun fichier de configuration utilisateur**. Les paramètres sont de trois sortes : constantes codées en dur, préférences enregistrées dans le navigateur interne, et variables d'environnement (build et binaire ffmpeg).

## 1. Sources de configuration

| Source | Portée | Où |
|---|---|---|
| Constantes de code | fixes, modifiées par recompilation | `main.js`, `renderer/renderer.js`, `package.json` |
| Préférences utilisateur | par utilisateur de la machine, persistantes | `localStorage` du renderer (dans le profil Electron) |
| Variables d'environnement | build et runtime ffmpeg | voir §6 |
| Configuration de build | électron-builder | `package.json`, clé `build` |

## 2. Constantes de code

### 2.1 Fenêtre

| Constante | Valeur | Réf. |
|---|---|---|
| Largeur × hauteur initiales | 1400 × 900 | `main.js` |
| Couleur de fond | `#000000` | `main.js` |
| Titre | « Media Sorter » | `main.js` |
| Barre de menu | masquée | `main.js` |
| Zoom natif de page | verrouillé à 1 | `main.js` |

### 2.2 Vidéo et ffmpeg

| Constante | Valeur | Réf. | Effet |
|---|---|---|---|
| `FRAME_INTERVAL_SEC` | 60 | `main.js` | Pas minimal entre deux images ; pas réel = `max(60 s, durée / MAX_FRAMES)` (voir features.md FN-07) |
| `MAX_FRAMES` | 20 | `main.js` | Plafond d'images par vidéo |
| `FFMPEG_TIMEOUT_MS` | 20 000 | `main.js` | Délai maximal par appel ffmpeg (extraction) |
| Délai de la sonde de durée | 15 000 ms | `main.js` | Délai avant arrêt de `ffmpeg -i` |
| Largeur des images | 400 px (hauteur proportionnelle, `-2`) | `main.js` | Taille des vignettes |
| Qualité JPEG | `-q:v 4` | `main.js` | Compression des images extraites |
| Extractions concurrentes (renderer) | 2 | `renderer/renderer.js` | File d'attente côté interface |
| Durée d'affichage d'une image | 1000 ms | `renderer/renderer.js` | Vitesse du stop-motion |

Arguments ffmpeg utilisés :

```
ffprobe-like :  ffmpeg -i <fichier>                       (lecture de la durée sur stderr, main.js)
extraction   :  ffmpeg -ss <t> -i <fichier> -frames:v 1 -vf scale=400:-2 -q:v 4 -y <frame_NNNN.jpg>   (main.js)
repli        :  ffmpeg -i <fichier> -frames:v 1 -vf scale=400:-2 -y frame_0001.jpg                    (main.js)
```

### 2.3 Zoom, vignettes et interface

| Constante | Valeur | Réf. |
|---|---|---|
| Zoom maximal (visionneuse) | 8 × | `renderer/renderer.js` |
| Facteur de molette (sans Ctrl) | `exp(-deltaY × 0.0015)` | `renderer/renderer.js` |
| Facteur de pincement (Ctrl + molette) | `exp(-deltaY × 0.01)` | `renderer/renderer.js` |
| Taille de vignette minimale | 110 px | `renderer/renderer.js` |
| Taille de vignette maximale | 480 px | `renderer/renderer.js` |
| Taille de vignette par défaut | 200 px | `renderer/styles.css` (repli de `var(--tile)`) |
| Durée des messages | 1800 ms | `renderer/renderer.js` |

### 2.4 Annulation et transferts (1.2.0)

| Constante | Valeur | Réf. | Effet |
|---|---|---|---|
| `MAX_ENTRIES` | 10 | `lib/undo.js` | Taille de la pile d'annulation |
| `STAGING_DIR` | `.media-sorter-staging` | `lib/undo.js` | Dossier caché, dans le dossier de chaque fichier mis à la corbeille |
| `STAGING_FALLBACK` | `EACCES`, `EPERM`, `EROFS` | `lib/undo.js` | Erreurs de staging qui basculent vers la corbeille directe (non annulable) |
| `PURGE_TIMEOUT_MS` | 10 000 | `main.js` | Délai maximal de la purge en quittant |
| `MIN_MARGIN_BYTES` | 200 Mo | `lib/fileops.js` | Marge d'espace minimale ; la marge réelle est max(200 Mo, 1 % du volume) |
| `PROGRESS_INTERVAL_MS` | 100 | `main.js` | Fréquence maximale des événements de progression |
| `PREVIEW_MAX` | 10 | `renderer/renderer.js` | Lignes d'aperçu du renommage en masse |

### 2.5 Types de fichiers

Définis dans `renderer/renderer.js` et répétés dans `package.json` pour les associations système (`build.fileAssociations`).

| Mode | Par défaut | Autres (optionnels) |
|---|---|---|
| Photos | `jpg`, `jpeg`, `png`, `webp` | `gif`, `bmp`, `avif` |
| Videos | `avi`, `mpg`, `mpeg`, `mkv` | `mp4`, `mov`, `m4v`, `webm`, `wmv`, `flv`, `3gp` |

Associations système déclarées (`package.json`, `build.fileAssociations`) : `jpg`, `jpeg`, `png`, `webp`, `gif`, `bmp`, `avif`, avec le type MIME correspondant. Les vidéos ne sont pas associées.

Remarques :
- **Formats photo décodables uniquement** : `tiff`, `tif` et `heic` ont été retirés du menu Types **et** des associations système (le 2026-10-17), car Chromium ne les décode pas — les lister n'apportait qu'un badge « sans aperçu ». La liste du menu et celle des associations sont donc désormais alignées. Code (`TYPE_SETS`) et README concordent (plus d'écart `tif`).
- **Vignettes vidéo** : passent par ffmpeg, qui décode presque tous les formats listés ; la lecture, elle, est confiée au lecteur du système.
- Le badge « sans aperçu » subsiste comme filet de sécurité pour un fichier coché mais illisible (corrompu, codec inattendu).

## 3. Préférences persistées

Stockées dans `localStorage` (origine `file://` de l'application), écrites par `savePrefs` (`renderer/renderer.js`) et relues par `loadPrefs` (`renderer/renderer.js`).

| Clé | Format | Défaut | Réglage UI | Validation à la lecture |
|---|---|---|---|---|
| `prefs` (JSON) → `recursive` | booléen | `false` | case **Subfolders** | booléen obligatoire, sinon ignoré |
| `prefs` → `maximize` | booléen | `false` | case **Maximize** | booléen obligatoire, sinon ignoré |
| `prefs` → `confirmDelete` | booléen | `true` | ⚙ **Préférences** → *Confirm before deleting* | booléen obligatoire, sinon ignoré |
| `prefs` → `showHidden` | booléen | `false` | ⚙ **Préférences** → *Show hidden files* | recharge la liste au changement |
| `prefs` → `followSymlinks` | booléen | `false` | ⚙ **Préférences** → *Follow symbolic links* | recharge la liste au changement |
| `prefs` → `sortBy` | `"name"` ou `"mtime"` | `"name"` | liste **Sort** | valeur inconnue ignorée |
| `prefs` → `sortDir` | `"asc"` ou `"desc"` | `"asc"` | bouton **↑ / ↓** | valeur inconnue ignorée |
| `prefs` → `types.photos` | tableau de chaînes | les 4 extensions par défaut | menu **Types ▾** | tableau obligatoire ; `loadPrefs` **filtre** les extensions inconnues (hors `TYPE_SETS`), p. ex. un `tiff`/`heic` enregistré est écarté au chargement |
| `prefs` → `types.videos` | tableau de chaînes | les 4 extensions par défaut | menu **Types ▾** | idem |
| `tileSize` | entier en chaîne | absent (200 px) | pincement Ctrl + molette | `parseInt` ; appliqué via `setTile` (borné 110–480) |

Comportement :
- Chaque changement réécrit l'intégralité de `prefs` (`renderer/renderer.js`).
- Un JSON corrompu est ignoré : l'application démarre avec les valeurs par défaut (`renderer/renderer.js`).
- Si `localStorage` est indisponible, les préférences sont simplement non persistées : aucune erreur n'est affichée.
- Un fichier ouvert via « Ouvrir avec » peut ajouter son extension à `types.<mode>` (`renderer/renderer.js`).

Non persisté : dossier courant, mode actif, sélection, historique d'annulation (vidé à chaque lancement, voir features.md FN-20), position de défilement, état de la visionneuse.

## 4. Cache des images vidéo

### 4.1 Emplacement et structure

```
<userData>/frames/<clé>/
    frame_0001.jpg
    frame_0002.jpg
    …
    .done                  (présent seulement si au moins une image a été produite)
```

- `<userData>` : dossier de données Electron de l'application (`app.getPath('userData')`, `main.js`). Voir §5.
- `<clé>` : les 16 premiers caractères hexadécimaux de `SHA-1("<chemin>:<mtimeMs>")` (`main.js`).
- Numérotation : `frame_NNNN.jpg` sur 4 chiffres, à partir de `0001` (`main.js`).

### 4.2 Règles de validité

- Une entrée est **réutilisée** si `.done` existe et contient au moins une image (`main.js`).
- La clé dépend du **chemin** et de la **date de modification** : modifier, renommer ou déplacer une vidéo crée une nouvelle entrée et laisse l'ancienne en place.
- Sans `.done` (aucune image produite), l'extraction est retentée à chaque affichage (`main.js`).

### 4.3 Nettoyage

**Purge au démarrage** (`pruneFrameCache`, appelée depuis `whenReady` dans `main.js`) : le cache est nettoyé à chaque lancement. Éviction d'abord par **âge** (dossiers non touchés depuis plus de **90 jours**, `CACHE_MAX_AGE_MS`), puis en **LRU** jusqu'à repasser sous un plafond de **500 Mo** (`CACHE_MAX_BYTES`). Chaque `rm` est best-effort (un échec n'interrompt pas le démarrage). Un **cache hit** met à jour le `mtime` du dossier (`fsp.utimes`), de sorte que le LRU suit l'usage réel et non la date de création.

Conséquence : une entrée orpheline (vidéo modifiée, renommée ou supprimée) finit par être évincée par l'âge ou le plafond ; le cache ne croît plus indéfiniment. Les seuils 90 j / 500 Mo sont des constantes ajustables en tête de section vidéo de `main.js`.

## 5. Chemins système

| Élément | macOS | Ubuntu / Linux | Réf. |
|---|---|---|---|
| Données Electron (`userData`) | `~/Library/Application Support/media-sorter/` | `~/.config/media-sorter/` | `main.js` |
| Cache des vignettes | `<userData>/frames/` | idem | `main.js` |
| Journal d'annulation | `<userData>/undo-journal.json` (`{entries, leftovers}`, vidé à chaque purge) | idem | `lib/undo.js` |
| Staging de la corbeille | `<dossier du fichier>/.media-sorter-staging/<id>__<nom>`, supprimé dès qu'il est vide | idem | `lib/undo.js` |
| Préférences | `<userData>` → stockage `localStorage` de Chromium | idem | `renderer/renderer.js` |
| Corbeille | corbeille du Finder (`macos-trash`) | corbeille XDG (`~/.local/share/Trash`) | `main.js`, `node_modules/trash/lib/` |
| Application installée | `/Applications/Media Sorter.app` (glisser-déposer depuis le `.dmg`) | `.deb` installé par apt (emplacement par défaut de electron-builder, probablement `/opt/`) ; AppImage : fichier portable exécutable | `README.md` |

Note sur `userData` : le `package.json` déclare `"name": "media-sorter"` et **pas** de `productName` au niveau racine (il n'existe que sous `build`, pour l'empaquetage). `app.getName()` — qui détermine `userData` — lit le `productName` racine s'il existe, sinon le `name`. Le dossier est donc **`media-sorter`** (et non « Media Sorter »), **de façon cohérente en dev et en app empaquetée** : `build.productName` ne nomme que le bundle `.app`, pas `getName()` au runtime. Écart purement cosmétique (nom technique ≠ nom affiché), volontairement laissé tel quel pour ne pas rendre orphelin le cache existant.

## 6. Variables d'environnement

### 6.1 Au runtime

| Variable | Effet | Réf. |
|---|---|---|
| `FFMPEG_BIN` | Si définie, remplace le chemin du binaire ffmpeg embarqué (comportement du paquet `ffmpeg-static`). | `node_modules/ffmpeg-static/index.js` |
| `LD_LIBRARY_PATH`, `GTK_PATH`, `QT_PLUGIN_PATH`, etc. | Lues pour l'assainissement des lancements externes (Linux) : supprimées, ou restaurées depuis `<NOM>_ORIG` quand elles existent. Liste complète : `main.js`. | `main.js` |
| `XDG_DATA_DIRS`, `XDG_CONFIG_DIRS` | Restaurées depuis `_ORIG` si présentes pour les processus fils. | `main.js` |
| `CHROME_DESKTOP` | Supprimée pour les processus fils. | `main.js` |

L'application n'a **pas** de variable de configuration propre.

### 6.2 Au build

| Variable | Usage | Source |
|---|---|---|
| `CSC_IDENTITY_AUTO_DISCOVERY=false` | Désactive la recherche automatique d'un certificat de signature macOS. Recommandé dans le README pour le build `dist:mac`. | `README.md` (Install permanently → macOS) |
| `npm_config_platform`, `npm_config_arch` | Plateforme et architecture ciblées pour le téléchargement du binaire ffmpeg à l'installation. | `node_modules/ffmpeg-static/install.js` |
| `FFMPEG_BINARY_RELEASE`, `FFMPEG_BINARIES_URL` | Version et source du binaire ffmpeg téléchargé (valeurs par défaut du paquet : release `b6.1.1`). | `node_modules/ffmpeg-static/package.json` |

## 7. Configuration de build (`package.json`)

Extrait des paramètres pertinents pour la configuration :

| Clé | Valeur | Réf. |
|---|---|---|
| `build.appId` | `com.mc.mediasorter` | `package.json` |
| `build.productName` | `Media Sorter` | `package.json` |
| `build.asar` | `false` | `package.json` |
| `build.afterPack` | `./build/afterPack.js` (nettoyage `Info.plist`, macOS) | `package.json` |
| `build.files` | `main.js`, `preload.js`, `lib/**/*`, `renderer/**/*`, `package.json` | `package.json` |
| `build.fileAssociations` | Image (jpg, jpeg, png, webp, gif, bmp, avif), rôle Viewer | `package.json` |
| `build.linux.target` | `AppImage`, `deb` | `package.json` |
| `build.linux.category` | `Graphics` | `package.json` |
| `build.mac.target` | `dmg` | `package.json` |
| `build.mac.category` | `public.app-category.photography` | `package.json` |
| `build.mac.artifactName` | `${productName}-${version}-${arch}.${ext}` | `package.json` |

Outil : electron-builder **26** (Electron 44) depuis la montée de version [Unreleased] ; la configuration ci-dessus est inchangée par rapport à electron-builder 24. `asar: false` reste voulu (electron-builder 26 affiche l'avertissement « asar usage is disabled », sans effet) : `ffmpeg` et `macos-trash` doivent rester des exécutables directement lancés. `engines.node` (`>=22.12.0`) est déclaré dans `package.json`.

Détails de packaging et de signature : voir [build-and-deploy.md](build-and-deploy.md).

## 8. Ce qui n'est pas configurable

- Le nombre d'images par vidéo, l'intervalle et la durée d'affichage (constantes §2.2).
- Les raccourcis clavier (codés dans `renderer/renderer.js`).
- Les applications d'édition : `GIMP` / `gimp` et `Shotcut` / `shotcut` sont codés en dur (`main.js`).
- Les types de fichiers au-delà des listes de §2.5.
- La langue : l'interface est en anglais (libellés) et l'aide des raccourcis aussi ; les commentaires du code sont en anglais.
