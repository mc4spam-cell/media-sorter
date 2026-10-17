# Configuration, formats et chemins

> Références `fichier:ligne` relatives à `/Users/mc/media-sorter`.
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
| Largeur × hauteur initiales | 1400 × 900 | `main.js:33-34` |
| Couleur de fond | `#000000` | `main.js:35` |
| Titre | « Media Sorter » | `main.js:36` |
| Barre de menu | masquée | `main.js:45` |
| Zoom natif de page | verrouillé à 1 | `main.js:49-51` |

### 2.2 Vidéo et ffmpeg

| Constante | Valeur | Réf. | Effet |
|---|---|---|---|
| `FRAME_INTERVAL_SEC` | 60 | `main.js:314` | Une image par minute de vidéo |
| `MAX_FRAMES` | 20 | `main.js:315` | Plafond d'images par vidéo |
| `FFMPEG_TIMEOUT_MS` | 20 000 | `main.js:316` | Délai maximal par appel ffmpeg (extraction) |
| Délai de la sonde de durée | 15 000 ms | `main.js:354` | Délai avant arrêt de `ffmpeg -i` |
| Largeur des images | 400 px (hauteur proportionnelle, `-2`) | `main.js:410`, `427` | Taille des vignettes |
| Qualité JPEG | `-q:v 4` | `main.js:411` | Compression des images extraites |
| Extractions concurrentes (renderer) | 2 | `renderer/renderer.js:194` | File d'attente côté interface |
| Durée d'affichage d'une image | 1000 ms | `renderer/renderer.js:234` | Vitesse du stop-motion |

Arguments ffmpeg utilisés :

```
ffprobe-like :  ffmpeg -i <fichier>                       (lecture de la durée sur stderr, main.js:352)
extraction   :  ffmpeg -ss <t> -i <fichier> -frames:v 1 -vf scale=400:-2 -q:v 4 -y <frame_NNNN.jpg>   (main.js:406-413)
repli        :  ffmpeg -i <fichier> -frames:v 1 -vf scale=400:-2 -y frame_0001.jpg                    (main.js:424-429)
```

### 2.3 Zoom, vignettes et interface

| Constante | Valeur | Réf. |
|---|---|---|
| Zoom maximal (visionneuse) | 8 × | `renderer/renderer.js:317` |
| Facteur de molette (sans Ctrl) | `exp(-deltaY × 0.0015)` | `renderer/renderer.js:396` |
| Facteur de pincement (Ctrl + molette) | `exp(-deltaY × 0.01)` | `renderer/renderer.js:396`, `685` |
| Taille de vignette minimale | 110 px | `renderer/renderer.js:659` |
| Taille de vignette maximale | 480 px | `renderer/renderer.js:660` |
| Taille de vignette par défaut | 200 px | `renderer/styles.css:173-174` (repli de `var(--tile)`) |
| Durée des messages | 1800 ms | `renderer/renderer.js:94` |

### 2.4 Types de fichiers

Définis dans `renderer/renderer.js:16-19` et répétés dans `package.json` pour les associations système (`build.fileAssociations`).

| Mode | Par défaut | Autres (optionnels) |
|---|---|---|
| Photos | `jpg`, `jpeg`, `png`, `webp` | `gif`, `bmp`, `avif`, `tiff`, `tif`, `heic` |
| Videos | `avi`, `mpg`, `mpeg`, `mkv` | `mp4`, `mov`, `m4v`, `webm`, `wmv`, `flv`, `3gp` |

Associations système déclarées (`package.json`, `build.fileAssociations`) : `jpg`, `jpeg`, `png`, `webp`, `gif`, `bmp`, `tiff`, `tif`, `avif`, avec le type MIME correspondant. Les vidéos ne sont pas associées.

Remarques :
- **Affichage** : Chromium n'affiche que les formats qu'il sait décoder. `tiff` et `heic` ne sont pas rendus et affichent un badge avec l'extension (`renderer/renderer.js:158-165`).
- **Vignettes vidéo** : passent par ffmpeg, qui décode presque tous les formats listés ; la lecture, elle, est confiée au lecteur du système.
- **[à confirmer]** : `heic` est listé dans le code et le README, mais absent de `fileAssociations`.
- **[à confirmer]** : le README ne cite pas `tif` parmi les formats photo supplémentaires, alors que le code le gère. Le CHANGELOG 1.1.0 ne le précise pas non plus.

## 3. Préférences persistées

Stockées dans `localStorage` (origine `file://` de l'application), écrites par `savePrefs` (`renderer/renderer.js:40-53`) et relues par `loadPrefs` (`renderer/renderer.js:54-70`).

| Clé | Format | Défaut | Réglage UI | Validation à la lecture |
|---|---|---|---|---|
| `prefs` (JSON) → `recursive` | booléen | `false` | case **Subfolders** | booléen obligatoire, sinon ignoré |
| `prefs` → `maximize` | booléen | `false` | case **Maximize** | booléen obligatoire, sinon ignoré |
| `prefs` → `confirmDelete` | booléen | `true` | ⚙ **Préférences** → *Confirm before deleting* | booléen obligatoire, sinon ignoré |
| `prefs` → `showHidden` | booléen | `false` | ⚙ **Préférences** → *Show hidden files* | recharge la liste au changement |
| `prefs` → `followSymlinks` | booléen | `false` | ⚙ **Préférences** → *Follow symbolic links* | recharge la liste au changement |
| `prefs` → `sortBy` | `"name"` ou `"mtime"` | `"name"` | liste **Sort** | valeur inconnue ignorée |
| `prefs` → `sortDir` | `"asc"` ou `"desc"` | `"asc"` | bouton **↑ / ↓** | valeur inconnue ignorée |
| `prefs` → `types.photos` | tableau de chaînes | les 4 extensions par défaut | menu **Types ▾** | tableau obligatoire ; le contenu n'est pas filtré |
| `prefs` → `types.videos` | tableau de chaînes | les 4 extensions par défaut | menu **Types ▾** | idem |
| `tileSize` | entier en chaîne | absent (200 px) | pincement Ctrl + molette | `parseInt` ; appliqué via `setTile` (borné 110–480) |

Comportement :
- Chaque changement réécrit l'intégralité de `prefs` (`renderer/renderer.js:40-53`).
- Un JSON corrompu est ignoré : l'application démarre avec les valeurs par défaut (`renderer/renderer.js:55-60`).
- Si `localStorage` est indisponible, les préférences sont simplement non persistées : aucune erreur n'est affichée.
- Un fichier ouvert via « Ouvrir avec » peut ajouter son extension à `types.<mode>` (`renderer/renderer.js:547-551`).

Non persisté : dossier courant, mode actif, sélection, position de défilement, état de la visionneuse.

## 4. Cache des images vidéo

### 4.1 Emplacement et structure

```
<userData>/frames/<clé>/
    frame_0001.jpg
    frame_0002.jpg
    …
    .done                  (présent seulement si au moins une image a été produite)
```

- `<userData>` : dossier de données Electron de l'application (`app.getPath('userData')`, `main.js:324`). Voir §5.
- `<clé>` : les 16 premiers caractères hexadécimaux de `SHA-1("<chemin>:<mtimeMs>")` (`main.js:318-325`).
- Numérotation : `frame_NNNN.jpg` sur 4 chiffres, à partir de `0001` (`main.js:404`).

### 4.2 Règles de validité

- Une entrée est **réutilisée** si `.done` existe et contient au moins une image (`main.js:378-381`).
- La clé dépend du **chemin** et de la **date de modification** : modifier, renommer ou déplacer une vidéo crée une nouvelle entrée et laisse l'ancienne en place.
- Sans `.done` (aucune image produite), l'extraction est retentée à chaque affichage (`main.js:384-433`).

### 4.3 Nettoyage

**Aucune purge n'est implémentée.** Le processus principal ne supprime jamais de fichier (aucun appel `unlink`, `rm` ou `rmdir` dans `main.js`). Le cache croît donc sans limite, et une entrée devient orpheline après modification ou suppression de la vidéo.

**[à confirmer]** : une purge du cache est-elle souhaitée ? Le README indique seulement que le cache permet une réouverture rapide du dossier.

## 5. Chemins système

| Élément | macOS | Ubuntu / Linux | Réf. |
|---|---|---|---|
| Données Electron (`userData`) | `~/Library/Application Support/media-sorter/` **[à confirmer]** | `~/.config/media-sorter/` **[à confirmer]** | `main.js:324` |
| Cache des vignettes | `<userData>/frames/` | idem | `main.js:324` |
| Préférences | `<userData>` → stockage `localStorage` de Chromium | idem | `renderer/renderer.js:40-70` |
| Corbeille | corbeille du Finder (`macos-trash`) | corbeille XDG (`~/.local/share/Trash`) **[à confirmer]** | `main.js:189-193`, `node_modules/trash/lib/` |
| Application installée | `/Applications/Media Sorter.app` (glisser-déposer depuis le `.dmg`) | `.deb` installé par apt (emplacement par défaut de electron-builder, probablement `/opt/`, **[à confirmer]**) ; AppImage : fichier portable exécutable | `README.md:61`, `README.md:85-86` |

Note sur `userData` : le paquet packagé déclare `"name": "media-sorter"` et **n'a pas de `productName`** (vérifié dans `dist/mac/Media Sorter.app/Contents/Resources/app/package.json`). Electron utilise le `productName` s'il existe, sinon le `name`. Le chemin réel est donc probablement en `media-sorter`, et non en `Media Sorter`. **[à confirmer]** en lançant l'application.

## 6. Variables d'environnement

### 6.1 Au runtime

| Variable | Effet | Réf. |
|---|---|---|
| `FFMPEG_BIN` | Si définie, remplace le chemin du binaire ffmpeg embarqué (comportement du paquet `ffmpeg-static`). | `node_modules/ffmpeg-static/index.js` |
| `LD_LIBRARY_PATH`, `GTK_PATH`, `QT_PLUGIN_PATH`, etc. | Lues pour l'assainissement des lancements externes (Linux) : supprimées, ou restaurées depuis `<NOM>_ORIG` quand elles existent. Liste complète : `main.js:225-236`. | `main.js:238-252` |
| `XDG_DATA_DIRS`, `XDG_CONFIG_DIRS` | Restaurées depuis `_ORIG` si présentes pour les processus fils. | `main.js:236`, `246-249` |
| `CHROME_DESKTOP` | Supprimée pour les processus fils. | `main.js:250` |

L'application n'a **pas** de variable de configuration propre.

### 6.2 Au build

| Variable | Usage | Source |
|---|---|---|
| `CSC_IDENTITY_AUTO_DISCOVERY=false` | Désactive la recherche automatique d'un certificat de signature macOS. Recommandé dans le README pour le build `dist:mac`. | `README.md:59` |
| `npm_config_platform`, `npm_config_arch` | Plateforme et architecture ciblées pour le téléchargement du binaire ffmpeg à l'installation. | `node_modules/ffmpeg-static/install.js` |
| `FFMPEG_BINARY_RELEASE`, `FFMPEG_BINARIES_URL` | Version et source du binaire ffmpeg téléchargé (valeurs par défaut du paquet : release `b6.1.1`). | `node_modules/ffmpeg-static/package.json` |

## 7. Configuration de build (`package.json`)

Extrait des paramètres pertinents pour la configuration :

| Clé | Valeur | Réf. |
|---|---|---|
| `build.appId` | `com.mc.mediasorter` | `package.json` |
| `build.productName` | `Media Sorter` | `package.json` |
| `build.asar` | `false` | `package.json` |
| `build.files` | `main.js`, `preload.js`, `renderer/**/*`, `package.json` | `package.json` |
| `build.linux.target` | `AppImage`, `deb` | `package.json` |
| `build.linux.category` | `Graphics` | `package.json` |
| `build.mac.target` | `dmg` | `package.json` |
| `build.mac.category` | `public.app-category.photography` | `package.json` |
| `build.mac.artifactName` | `${productName}-${version}-${arch}.${ext}` | `package.json` |

Détails de packaging et de signature : voir [build-and-deploy.md](build-and-deploy.md).

## 8. Ce qui n'est pas configurable

- Le nombre d'images par vidéo, l'intervalle et la durée d'affichage (constantes §2.2).
- Les raccourcis clavier (codés dans `renderer/renderer.js:696-744`).
- Les applications d'édition : `GIMP` / `gimp` et `Shotcut` / `shotcut` sont codés en dur (`main.js:287-290`).
- Les types de fichiers au-delà des listes de §2.4.
- La langue : l'interface est en anglais (libellés) et l'aide des raccourcis aussi ; les commentaires du code sont en anglais.
