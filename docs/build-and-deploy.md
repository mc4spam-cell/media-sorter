# Build, déploiement et versioning

> Références au code : fichier et symbole, sans numéro de ligne ; chemins relatifs à la racine du projet.
> Version documentée : **1.3.1** (`package.json`, `CHANGELOG.md`).
> Voir aussi [config.md §7](config.md#7-configuration-de-build-packagejson) pour la configuration `electron-builder`.

## 1. Prérequis

| Élément | Exigence | Source |
|---|---|---|
| Node.js | ≥ 22.12 depuis Electron 44 (le script Ubuntu installe Node 22.x si absent ou trop ancien) ; 1.2.0 et antérieures : ≥ 18 | `package.json` (`engines`), `install-ubuntu.sh` |
| npm | fourni avec Node | — |
| Build macOS (`.dmg`) | Être sous macOS | convention electron-builder, non vérifiée dans le dépôt |
| Build Linux (`AppImage`, `.deb`) | Être **sous Linux** | `README.md` : le binaire ffmpeg est téléchargé pour la plateforme de build |
| Exécution AppImage | `libfuse2` (ou `libfuse2t64`) | `install-ubuntu.sh` |
| Éditeurs externes (optionnels) | GIMP, Shotcut | `README.md`, touches G et S |

## 2. Scripts npm

| Commande | Effet | Sortie |
|---|---|---|
| `npm install` | Installe les dépendances (dev incluses) et télécharge le binaire ffmpeg pour la plateforme courante (`ffmpeg-static`, script `install`). Depuis Electron 42, le binaire Electron n'est plus téléchargé ici mais au premier `npm start` | `node_modules/` |
| `npm start` | `electron .` : lance l'application en mode développement | — |
| `npm run dist:linux` | `electron-builder --linux AppImage deb` | `dist/*.AppImage`, `dist/*.deb` |
| `npm run dist:mac` | `electron-builder --mac dmg` | `dist/*.dmg`, `dist/*.dmg.blockmap`, `dist/latest-mac.yml`, `dist/mac/` |

Il n'existe **ni script de test, ni script de lint** dans `package.json`.

## 3. Ubuntu / Linux

### 3.1 Cibles électron-builder

- `AppImage` : exécutable portable, sans installation (`package.json`).
- `.deb` : paquet Debian, installé avec apt ; enregistre les associations de fichiers image, contrairement à l'AppImage (`CHANGELOG.md:17-19`).
- Catégorie : `Graphics` (`package.json`).

### 3.2 Installation par script (recommandée)

```bash
git clone https://github.com/mc4spam-cell/media-sorter.git
cd media-sorter
bash install-ubuntu.sh
```

Étapes du script `install-ubuntu.sh` (`set -euo pipefail`, `install-ubuntu.sh`) :

| # | Étape | Lignes |
|---|---|---|
| 1 | Se place dans le dossier du script et vérifie la présence de `package.json` | 15-17 |
| 2 | Installe `git`, `curl`, `ca-certificates`, `libfuse2` (repli sur `libfuse2t64`) | 21-22 |
| 3 | Vérifie Node ≥ 22.12 ; sinon installe Node 22.x via NodeSource puis `nodejs` | 24-39 |
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

Puis, au choix (`README.md`) :
- `chmod +x dist/*.AppImage && ./dist/*.AppImage` ;
- `sudo apt install ./dist/*.deb`, et lancement depuis le menu.

### 3.4 Dépendances à l'exécution

- Le lecteur vidéo par défaut est celui du système, ouvert via `xdg-open` (`main.js`).
- GIMP et Shotcut doivent être installés séparément pour les touches G et S.
- La corbeille utilise la spécification XDG (`node_modules/trash/lib/linux.js`).

## 4. macOS

### 4.1 Build

```bash
npm install
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
```

(`README.md`.) La variable désactive la recherche automatique d'un certificat de signature. **Aucune signature ni notarisation n'est configurée** dans `package.json` : pas d'identité, pas de `hardenedRuntime`, pas de `notarize`.

Avec electron-builder 26 (1.3.0), le build affiche « skipped macOS application code signing » : le bundle n'est pas scellé, mais les exécutables Mach-O d'Electron restent signés ad hoc par l'éditeur de liens (`codesign -dv` : `flags=adhoc,linker-signed`), ce qui suffit pour lancer l'app arm64 sur Apple Silicon. Vérifié sur un build `--arm64` croisé depuis un Mac Intel (2026-10-19), non lancé sur Apple Silicon ; un tel build croisé embarque le ffmpeg x64, d'où la règle « une machine par cible » de `scripts/release.sh`. Le `.dmg` exige **macOS 13** ou plus récent.

### 4.2 Installation et Gatekeeper

1. Ouvrir le `.dmg`, glisser **Media Sorter** dans **Applications**.
2. L'application étant non signée, Gatekeeper bloque le premier lancement. Deux solutions (`README.md`) :
   - clic droit sur l'application, puis **Ouvrir**, puis **Ouvrir** ;
   - `xattr -dr com.apple.quarantine "/Applications/Media Sorter.app"`.

### 4.3 Artefacts et architecture

- Nom des fichiers (config HEAD) : `${productName}-${version}-${arch}.${ext}` (`package.json`, ajouté par le commit `8048843`). electron-builder substitue `${arch}` par `x64` ou `arm64` : les **prochains** builds mac sortiront donc en `-x64.dmg` / `-arm64.dmg`.
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
| `LSMinimumSystemVersion` | `10.15` (1.2.0, Electron 31) ; **`13.0`** avec Electron 44 | valeur par défaut Electron, non déclarée dans `package.json` |
| `CFBundleIconFile` | `electron.icns` | **icône par défaut d'Electron** : aucune icône propre n'est configurée (`build/icon.icns` absent). Choix assumé pour l'instant (voir ci-dessous). |
| `CFBundleDocumentTypes` | Image, rôle Viewer, extensions jpg/jpeg/png/webp/gif/bmp/avif | issu de `build.fileAssociations` (tiff/tif retirés le 2026-10-17 ; le DMG 1.1.0 publié, antérieur, les contient encore) |
| `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSBluetoothAlwaysUsageDescription` | **supprimées** | retirées par le hook `afterPack` (le 2026-10-17) ; l'app n'utilise ni caméra, ni micro, ni Bluetooth |
| `NSAppTransportSecurity.NSAllowsArbitraryLoads` | **`false`** | resserré par le hook `afterPack` ; l'app ne fait aucun appel réseau (le DMG 1.1.0 publié, antérieur, a encore `true`) |
| `NSHumanReadableCopyright` | « Copyright © 2026 mc » | dérivé de l'auteur du `package.json` |

**Nettoyage du plist (`build/afterPack.js`)** : un hook `afterPack` electron-builder (macOS uniquement) supprime les trois clés d'usage inutiles et remplace le bloc ATS par `{ NSAllowsArbitraryLoads: false }`, via `PlistBuddy`. `extendInfo` n'étant pas fiable pour *supprimer* une clé, le hook est la méthode retenue. S'applique aux **prochains** builds mac.

**Icône (laissé tel quel — option A3)** : l'app utilise encore l'icône Electron par défaut. Pour fournir une icône propre plus tard : ajouter `build/icon.icns` (+ `build/icon.png` 512/1024 px pour Linux) et, au besoin, `build.icon` ; aucune autre config n'est requise (electron-builder détecte `build/icon.*`).

## 5. Versioning et publication

### 5.1 Schéma

- **SemVer** (`CHANGELOG.md:4`) et format **Keep a Changelog**.
- Version unique dans `package.json` (`package.json`). Elle est reprise dans le bundle macOS (`CFBundleShortVersionString`) et dans `latest-mac.yml`.

### 5.2 Historique

| Version | Date | Points clés | Tag git |
|---|---|---|---|
| 1.0.0 | 2026-06-04 | Version initiale (macOS + Linux) | `v1.0.0` |
| 1.0.1 | 2026-06-06 | Correctif : lancement sain des applications externes depuis l'AppImage | `v1.0.1` |
| 1.1.0 | 2026-10-17 | Bouton des raccourcis, « Ouvrir avec » | `v1.1.0` |
| 1.2.0 | 2026-10-18 | Annulation (10 actions), sélection multiple, renommage en masse, déplacement/copie, Cmd/Ctrl+touche = touche seule | `v1.2.0` |
| 1.2.1 | 2026-10-19 | Rotation sans perte (← / →, ↑ / ↓ naviguent), corbeille sans interprétation glob | `v1.2.1` |
| 1.3.0 | 2026-10-20 | Electron 44 / electron-builder 26 / trash 9 (macOS 13+, Node 22.12+ pour construire), script de release unique pour les 4 plateformes | `v1.3.0` |
| 1.3.1 | 2026-10-20 | `.deb` : types MIME valides ; rotation WebP sous Linux arm64 via le ffmpeg système ; scripts : installation depuis `/tmp`, rappel « detached HEAD » | `v1.3.1` |

Les tags `v1.0.0` à `v1.3.1` existent dans le dépôt (`git tag -l`). `v1.2.0` pointe sur `063e390` (avant la rotation). Le commit `889e4a2` est intitulé « Release 1.1.0 », `f66e9aa` « Release 1.2.0 ».

### 5.3 Procédure de sortie

**Préparer** (une fois, sur n'importe quelle machine) :

1. Mettre à jour la version dans `package.json`.
2. Ajouter la section de version et sa date dans `CHANGELOG.md`, plus le lien de release en bas de fichier.
3. Committer et pousser.

**Construire et publier** — un seul script, `scripts/release.sh` (depuis la 1.3.0 ; il remplace les `release-*.sh` du 2026-10-17). Il se lance **sur chaque machine cible**, détecte la plateforme et produit ses artefacts :

| Machine | Cible | Artefacts |
|---|---|---|
| Mac Intel | `mac-x64` | `Media Sorter-<v>-x64.dmg` |
| Mac Apple Silicon (terminal natif, pas Rosetta) | `mac-arm64` | `Media Sorter-<v>-arm64.dmg` |
| Linux x86_64 | `linux-amd64` | `media-sorter_<v>_amd64.deb` + `Media Sorter-<v>.AppImage` |
| Linux aarch64 (ex. VM Ubuntu sur Apple Silicon) | `linux-arm64` | `media-sorter_<v>_arm64.deb` (pas d'AppImage) |

```bash
git fetch --tags && git checkout vX.Y.Z   # le commit tagué (ou main pour le premier)
bash scripts/release.sh                   # = npm run release : construire + publier
bash scripts/release.sh --no-upload       # = npm run build:check : construire + vérifier seulement
```

Options : `--no-upload`, `--no-install` (sauter `npm ci`), `--yes` (répondre oui à tout).

Étapes, avec les pièges qu'elles évitent :

1. **Environnement** : remet `/usr/bin`, `/bin`… dans le `PATH` s'ils manquent (sinon « spawn sips ENOENT »), ajoute Homebrew ; refuse un terminal Rosetta sur Apple Silicon ; exige Node ≥ la version de `engines` avec **npm ≥ 10** (le paquet `npm` 9 d'Ubuntu casse avec Node 22). Sous Linux, propose de les remplacer par Node 22 de NodeSource.
2. **Source** : pour publier, exige un arbre propre et que **HEAD soit le commit du tag `vX.Y.Z`** (sinon `git checkout vX.Y.Z`) ; si le tag n'existe pas, propose de le créer sur HEAD (déjà poussé) et de le pousser.
3. **Dépendances** : **`npm ci` systématique** — des `node_modules` laissés par une autre branche construiraient le mauvais Electron, et `ffmpeg-static` ne télécharge que le ffmpeg de la machine hôte (aucune compilation croisée possible, d'où « une machine par cible »). Sur **linux-arm64**, installe au besoin le `fpm` du système (`USE_SYSTEM_FPM=true`) : celui d'electron-builder est x86_64.
4. **Construction** : `electron-builder` pour la cible (dmg ; deb + AppImage ; deb seul en arm64).
5. **Vérification** : présence des artefacts attendus, de `lib/` et de la bonne version dans le paquet, architecture du ffmpeg embarqué (`file`), encodeur WebP (sinon : un ffmpeg système le fournit-il ? cas de linux-arm64).
6. **Publication** : crée la release GitHub si absente (notes = section du CHANGELOG), puis téléverse avec `--clobber`. Idempotent : chaque machine ajoute ses fichiers, dans n'importe quel ordre.

Sous Ubuntu, `install-ubuntu.sh` installe les paquets système (git, curl, file, FUSE), propose GIMP/Shotcut, appelle `scripts/release.sh --no-upload`, puis propose d'installer le `.deb` de l'architecture de la machine (copié dans `/tmp` d'abord : sinon apt, qui lit les paquets locaux sous l'utilisateur `_apt`, affiche « Download is performed unsandboxed as root… Permission denied », sans conséquence). Si aucun ffmpeg n'a l'encodeur WebP (arm64), il propose `apt install ffmpeg`.

Après `git checkout vX.Y.Z`, git signale « You are in 'detached HEAD' state » : c'est normal pour construire un tag ; les scripts rappellent `git checkout main` pour revenir.

Nommage : electron-builder produit `-x64` / `-arm64` (config `artifactName`, commit `8048843`). La release 1.1.0, antérieure, porte des suffixes `-intel`/`-arm64` posés à la main (voir §4.3).

### 5.4 Mise à jour automatique

- Aucune logique d'auto-update dans `main.js` (aucune référence à `autoUpdater`).
- `latest-mac.yml` et `app-update.yml` sont générés par electron-builder, mais **rien ne les consomme** dans l'application.
- Conséquence : une nouvelle version s'installe manuellement (télécharger l'artefact depuis GitHub Releases).

**Évolution possible** : brancher `electron-updater` sur ces fichiers permettrait des mises à jour en place (implique une application signée et notarisée). Listé dans [README.md](README.md#évolutions-possibles).

### 5.5 Artefacts non versionnés

`dist/` et `node_modules/` sont ignorés par git (`.gitignore`). Les artefacts ne sont donc pas dans l'historique : ils doivent être conservés ou publiés hors dépôt.

## 6. Matrice de cibles

| Cible | À lancer sur | Commande | Artefacts |
|---|---|---|---|
| macOS Intel (x64) | Mac Intel | `bash scripts/release.sh` | `.dmg` x64 |
| macOS Apple Silicon (arm64) | Mac Apple Silicon | `bash scripts/release.sh` | `.dmg` arm64 |
| Linux x64 | Linux x86_64 | `bash scripts/release.sh` (ou `install-ubuntu.sh`) | `.deb` amd64 + `.AppImage` |
| Linux arm64 | Linux aarch64 | `bash scripts/release.sh` (ou `install-ubuntu.sh`) | `.deb` arm64 |
| Windows | — | — | non ciblé |

Les commandes brutes `npm run dist:mac` / `dist:linux` existent toujours, mais sautent toutes les vérifications du script.

## 7. Points d'attention

- **README** : mis à jour le 2026-10-17 — il pointe désormais vers la page GitHub Releases et liste les trois artefacts 1.1.0 (il citait auparavant `dist/Media Sorter-1.0.0.dmg`).
- **Nom des artefacts macOS** : la release 1.1.0 utilise des suffixes `-intel`/`-arm64` posés manuellement ; depuis le commit `8048843`, les builds locaux emploient le nommage automatique `-x64`/`-arm64` (voir §4.3).
- **Pas de signature** : l'avertissement Gatekeeper est attendu pour tout utilisateur qui n'est pas le propriétaire de la machine de build.
- **ffmpeg par plateforme** : un `.AppImage` ou `.deb` construit sur macOS embarquerait le binaire macOS, et les vignettes vidéo ne fonctionneraient pas (`README.md`).
- **Pas de tests** : toute validation passe par l'exécution manuelle (`npm start`).
