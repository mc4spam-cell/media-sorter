# Build, déploiement et versioning

> Références `fichier:ligne` relatives à `/Users/mc/media-sorter`.
> Version documentée : **1.1.0** (`package.json:3`, `CHANGELOG.md:7`).
> Voir aussi [config.md §7](config.md#7-configuration-de-build-packagejson) pour la configuration `electron-builder`.

## 1. Prérequis

| Élément | Exigence | Source |
|---|---|---|
| Node.js | ≥ 18 (le script Ubuntu installe Node 20.x si absent ou trop ancien) | `install-ubuntu.sh:26-37` |
| npm | fourni avec Node | — |
| Build macOS (`.dmg`) | Être sous macOS | convention electron-builder, non vérifiée dans le dépôt |
| Build Linux (`AppImage`, `.deb`) | Être **sous Linux** | `README.md:67` : le binaire ffmpeg est téléchargé pour la plateforme de build |
| Exécution AppImage | `libfuse2` (ou `libfuse2t64`) | `install-ubuntu.sh:22` |
| Éditeurs externes (optionnels) | GIMP, Shotcut | `README.md:89`, touches G et S |

## 2. Scripts npm

| Commande | Effet | Sortie |
|---|---|---|
| `npm install` | Installe les dépendances (dev incluses) et télécharge le binaire ffmpeg pour la plateforme courante (`ffmpeg-static`, script `install`) | `node_modules/` |
| `npm start` | `electron .` : lance l'application en mode développement | — |
| `npm run dist:linux` | `electron-builder --linux AppImage deb` | `dist/*.AppImage`, `dist/*.deb` |
| `npm run dist:mac` | `electron-builder --mac dmg` | `dist/*.dmg`, `dist/*.dmg.blockmap`, `dist/latest-mac.yml`, `dist/mac/` |

Il n'existe **ni script de test, ni script de lint** dans `package.json`.

## 3. Ubuntu / Linux

### 3.1 Cibles électron-builder

- `AppImage` : exécutable portable, sans installation (`package.json:41-45`).
- `.deb` : paquet Debian, installé avec apt ; enregistre les associations de fichiers image, contrairement à l'AppImage (`CHANGELOG.md:17-19`).
- Catégorie : `Graphics` (`package.json:45`).

### 3.2 Installation par script (recommandée)

```bash
git clone https://github.com/mc4spam-cell/media-sorter.git
cd media-sorter
bash install-ubuntu.sh
```

Étapes du script `install-ubuntu.sh` (`set -euo pipefail`, `install-ubuntu.sh:6`) :

| # | Étape | Lignes |
|---|---|---|
| 1 | Se place dans le dossier du script et vérifie la présence de `package.json` | 15-17 |
| 2 | Installe `git`, `curl`, `ca-certificates`, `libfuse2` (repli sur `libfuse2t64`) | 21-22 |
| 3 | Vérifie Node ≥ 18 ; sinon installe Node 20.x via NodeSource puis `nodejs` | 26-37 |
| 4 | **Demande** d'installer GIMP et Shotcut (réponse par défaut : non) | 42-46 |
| 5 | `npm install` puis `npm run dist:linux` | 49-53 |
| 6 | Rend l'AppImage exécutable | 59 |
| 7 | **Demande** d'installer le `.deb` (réponse par défaut : oui) → `sudo apt-get install ./<deb>` puis sortie | 68-73 |
| 8 | Sinon, affiche le chemin de l'AppImage | fin du script |

Le script reste **interactif** (`sudo`), mais les invites `read -rp` sont désormais suffixées de `|| true` (corrigé le 2026-10-17) : sur une entrée fermée (exécution non interactive, pipe), le `read` n'abat plus le script sous `set -e` et la valeur par défaut s'applique (N pour les éditeurs, Y pour l'installation du `.deb`).

### 3.3 Installation manuelle

```bash
sudo apt install -y nodejs npm        # si absent
git clone https://github.com/mc4spam-cell/media-sorter.git && cd media-sorter
npm install
npm run dist:linux
```

Puis, au choix (`README.md:84-86`) :
- `chmod +x dist/*.AppImage && ./dist/*.AppImage` ;
- `sudo apt install ./dist/*.deb`, et lancement depuis le menu.

### 3.4 Dépendances à l'exécution

- Le lecteur vidéo par défaut est celui du système, ouvert via `xdg-open` (`main.js:278`).
- GIMP et Shotcut doivent être installés séparément pour les touches G et S.
- La corbeille utilise la spécification XDG (`node_modules/trash/lib/linux.js`).

## 4. macOS

### 4.1 Build

```bash
npm install
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
```

(`README.md:57-59`.) La variable désactive la recherche automatique d'un certificat de signature. **Aucune signature ni notarisation n'est configurée** dans `package.json` : pas d'identité, pas de `hardenedRuntime`, pas de `notarize`.

### 4.2 Installation et Gatekeeper

1. Ouvrir le `.dmg`, glisser **Media Sorter** dans **Applications**.
2. L'application étant non signée, Gatekeeper bloque le premier lancement. Deux solutions (`README.md:62-64`) :
   - clic droit sur l'application, puis **Ouvrir**, puis **Ouvrir** ;
   - `xattr -dr com.apple.quarantine "/Applications/Media Sorter.app"`.

### 4.3 Artefacts et architecture

- Nom des fichiers (config HEAD) : `${productName}-${version}-${arch}.${ext}` (`package.json:52`, ajouté par le commit `8048843`). electron-builder substitue `${arch}` par `x64` ou `arm64` : les **prochains** builds mac sortiront donc en `-x64.dmg` / `-arm64.dmg`.
- Aucune architecture n'est forcée : `npm run dist:mac` construit pour l'architecture de la machine de build. Un build universel ou multi-arch demanderait `--x64 --arm64` (non configuré).

**Artefacts réellement publiés — GitHub Releases, tag `v1.1.0` (publié le 2026-10-17 12:47 UTC) :**

| Asset GitHub | Taille | Cible |
|---|---|---|
| `Media Sorter-1.1.0-arm64.dmg` | 147 794 300 o | macOS Apple Silicon |
| `Media Sorter-1.1.0-intel.dmg` | 126 921 544 o | macOS Intel (x86_64) |
| `media-sorter_1.1.0_amd64.deb` | 116 816 968 o | Linux x64 |

Les **trois packages sont distincts et valides** (tailles et empreintes différentes). Le build Apple Silicon existe bien.

> Les suffixes `-intel` / `-arm64` de la release ont été **appliqués manuellement** à l'upload : la release (12:47 UTC) précède le commit `8048843` (17:10 locale) qui introduit le nommage automatique par `${arch}`. electron-builder ne produit pas le libellé `intel` (il emploie `x64`) ; les prochaines releases porteront donc `-x64` au lieu de `-intel`, sauf renommage manuel volontaire pour garder le libellé « intel ».

**État du dossier `dist/` local (au 2026-10-17) — à ne pas confondre avec les artefacts publiés :**

| Fichier | Taille / empreinte | Constat |
|---|---|---|
| `Media Sorter-1.1.0.dmg` | 126 921 544 o, SHA-256 `0818ab3d…` | Binaire **x86_64**, produit par cette machine Intel |
| `Media Sorter-1.1.0-intel.dmg` | 126 921 544 o, SHA-256 `0818ab3d…` | **Copie renommée** du précédent (= l'asset `-intel` publié) |
| `mac/Media Sorter.app` | — | `Contents/MacOS/Media Sorter` : Mach-O x86_64 |

Le `dist/` local est un **état de build partiel, non représentatif de la release** : il ne contient que la sortie x64 de cette machine Intel (plus une copie renommée). Le `.dmg` arm64 publié a été produit ailleurs (machine Apple Silicon) et n'est pas présent ici. Pour régénérer localement un nom conforme à la config, relancer `npm run dist:mac` (le dmg sortira en `-x64.dmg`).

### 4.4 Métadonnées du bundle (`Info.plist`)

Lu dans `dist/mac/Media Sorter.app/Contents/Info.plist` :

| Clé | Valeur | Commentaire |
|---|---|---|
| `CFBundleIdentifier` | `com.mc.mediasorter` | issu de `appId` |
| `CFBundleShortVersionString` / `CFBundleVersion` | `1.1.0` | |
| `LSMinimumSystemVersion` | `10.15` | valeur par défaut Electron, non déclarée dans `package.json` |
| `CFBundleIconFile` | `electron.icns` | **icône par défaut d'Electron**, aucune icône propre n'est configurée (`build/` absent) |
| `CFBundleDocumentTypes` | Image, rôle Viewer, extensions jpg/jpeg/png/webp/gif/bmp/avif | issu de `build.fileAssociations` (tiff/tif retirés le 2026-10-17 ; le DMG 1.1.0 publié, antérieur, les contient encore) |
| `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSBluetoothAlwaysUsageDescription` | textes génériques | valeurs par défaut Electron, l'application n'utilise ni caméra, ni micro, ni Bluetooth |
| `NSAppTransportSecurity.NSAllowsArbitraryLoads` | `true` | valeur par défaut Electron, l'application ne fait aucun appel réseau |
| `NSHumanReadableCopyright` | « Copyright © 2026 mc » | dérivé de l'auteur du `package.json` |

**[à confirmer]** : faut-il nettoyer ces clés héritées d'Electron et ajouter une icône propre (`build/icon.icns`, `build/icon.png`) ?

## 5. Versioning et publication

### 5.1 Schéma

- **SemVer** (`CHANGELOG.md:4`) et format **Keep a Changelog**.
- Version unique dans `package.json` (`package.json:3`). Elle est reprise dans le bundle macOS (`CFBundleShortVersionString`) et dans `latest-mac.yml`.

### 5.2 Historique

| Version | Date | Points clés | Tag git |
|---|---|---|---|
| 1.0.0 | 2026-06-04 | Version initiale (macOS + Linux) | `v1.0.0` |
| 1.0.1 | 2026-06-06 | Correctif : lancement sain des applications externes depuis l'AppImage | `v1.0.1` |
| 1.1.0 | 2026-10-17 | Bouton des raccourcis, « Ouvrir avec » | `v1.1.0` |

Les trois tags existent dans le dépôt (`git tag -l`). Le commit `889e4a2` est intitulé « Release 1.1.0 ».

### 5.3 Procédure de sortie (déduite de l'historique)

Le dépôt ne contient pas de script de release. La procédure suivante est **déduite** des commits et du CHANGELOG :

1. Mettre à jour la version dans `package.json`.
2. Ajouter la section de version et sa date dans `CHANGELOG.md`, ainsi que le lien de release en bas de fichier.
3. Lancer `npm run dist:linux` (sous Linux) et `npm run dist:mac` (sous macOS).
4. Créer le tag `vX.Y.Z` et publier les artefacts sur GitHub Releases (`https://github.com/mc4spam-cell/media-sorter/releases/tag/vX.Y.Z`).
5. Les dmg mac étant construits sur la machine correspondant à l'architecture, le build arm64 et le build intel proviennent de machines distinctes ; les uploader tous deux, plus le `.deb` Linux.

**Vérifié (2026-10-17)** : les trois artefacts 1.1.0 sont bien présents sur GitHub Releases (`arm64.dmg`, `intel.dmg`, `amd64.deb` — voir §4.3). Le renommage `-intel`/`-arm64` est manuel à l'upload (le nommage automatique via `${arch}` n'est effectif que depuis le commit `8048843`, postérieur à cette release).

### 5.4 Mise à jour automatique

- Aucune logique d'auto-update dans `main.js` (aucune référence à `autoUpdater`).
- `latest-mac.yml` et `app-update.yml` sont générés par electron-builder, mais **rien ne les consomme** dans l'application.
- Conséquence : une nouvelle version doit être installée manuellement.

**[à confirmer]** : une mise à jour automatique est-elle prévue ?

### 5.5 Artefacts non versionnés

`dist/` et `node_modules/` sont ignorés par git (`.gitignore`). Les artefacts ne sont donc pas dans l'historique : ils doivent être conservés ou publiés hors dépôt.

## 6. Matrice de cibles

| Cible | Commande | Artefacts attendus | Publié (GitHub Releases v1.1.0) | `dist/` local |
|---|---|---|---|---|
| macOS Intel (x64) | `npm run dist:mac` (sur Mac Intel) | `.dmg` x64 | ✅ `…-intel.dmg` | présent (x64) |
| macOS Apple Silicon (arm64) | `npm run dist:mac` (sur Mac Apple Silicon) | `.dmg` arm64 | ✅ `…-arm64.dmg` | absent (build fait ailleurs) |
| Linux x64 | `npm run dist:linux` (sur Linux) | `.AppImage`, `.deb` | ✅ `…_amd64.deb` | absent (build non réalisé ici) |
| Windows | — | — | non ciblé | — |

## 7. Points d'attention

- **README** : mis à jour le 2026-10-17 — il pointe désormais vers la page GitHub Releases et liste les trois artefacts 1.1.0 (il citait auparavant `dist/Media Sorter-1.0.0.dmg`).
- **Nom des artefacts macOS** : la release 1.1.0 utilise des suffixes `-intel`/`-arm64` posés manuellement ; depuis le commit `8048843`, les builds locaux emploient le nommage automatique `-x64`/`-arm64` (voir §4.3).
- **Pas de signature** : l'avertissement Gatekeeper est attendu pour tout utilisateur qui n'est pas le propriétaire de la machine de build.
- **ffmpeg par plateforme** : un `.AppImage` ou `.deb` construit sur macOS embarquerait le binaire macOS, et les vignettes vidéo ne fonctionneraient pas (`README.md:67`).
- **Pas de tests** : toute validation passe par l'exécution manuelle (`npm start`).
