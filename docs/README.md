# Media Sorter : documentation de spécifications

Spécifications fonctionnelles et techniques de **Media Sorter**, trieur de photos et vidéos en Electron.
Version documentée : **1.1.0**.

Ces documents sont **reconstitués à partir du code source** (`main.js`, `preload.js`, `renderer/`, `package.json`, `install-ubuntu.sh`) et des fichiers d'accompagnement (`README.md`, `CHANGELOG.md`). Quand le code ne tranche pas un comportement, le point est marqué **[à confirmer]** et repris dans la liste ci-dessous.

## Sommaire

| Document | Contenu |
|---|---|
| [overview.md](overview.md) | But de l'application, personas, périmètre, workflow de tri, glossaire |
| [architecture.md](architecture.md) | Processus Electron, pont IPC, renderer, flux de données, dépendances, sécurité |
| [features.md](features.md) | Spécifications détaillées `FN-01` à `FN-19` : dossiers, types, tri, grille, vidéos, visionneuse, actions, raccourcis |
| [build-and-deploy.md](build-and-deploy.md) | Scripts npm, build macOS et Ubuntu, installation, versioning, publication |
| [config.md](config.md) | Constantes, préférences persistées, formats, cache, chemins système, variables d'environnement |

Les références de code sont au format `fichier:ligne`, relatives à la racine du projet.

## Conventions

- **`FN-xx`** : identifiant d'une fonctionnalité, pour citer un comportement lors d'une validation.
- **[à confirmer]** : comportement non tranché par le code, ou divergence entre le code, le README et le build.
- Les sections « Points de vigilance » signalent des risques observés, sans les corriger.

---

## Points à confirmer

Liste consolidée, regroupée par nature. Le numéro sert de référence pour la validation.

### A. Choix de comportement à valider

| # | Sujet | Où | Question |
|---|---|---|---|
| 1 | Suppression sans confirmation | [features.md FN-12](features.md#fn-12-mise-à-la-corbeille-touche-x) | La touche X met à la corbeille immédiatement, sans confirmation ni annulation. Voulu ? |
| 2 | ~~Modificateurs ignorés~~ — **validé : voulu (2026-10-17)** | [features.md FN-17](features.md#10-raccourcis-clavier) | `Cmd+X`, `Ctrl+R`… déclenchent la même action que la touche seule, **volontairement** : robustesse quand les affectations `Ctrl`/`Cmd`/`Option`/`Fn` diffèrent (VM, macOS vs Linux natif). |
| 3 | ~~Vignette vidéo sans image~~ — **résolu (2026-10-17)** | [features.md FN-07](features.md#5-vignettes-grille) | Quand l'extraction aboutit à 0 image (erreur **ou** liste vide), la vignette affiche désormais « NO PREVIEW » au lieu d'un spinner infini (helper `markNoPreview`). |
| 4 | ~~Vidéos longues~~ — **résolu (2026-10-17)** | [features.md FN-07](features.md#5-vignettes-grille) | Échantillonnage adaptatif : 20 images réparties sur toute la durée (intervalle `max(60 s, durée/20)`). Cadence 60 s inchangée ≤ 20 min, pas élargi au-delà. S'applique aux extractions futures (le cache existant n'est pas invalidé). |
| 5 | ~~Tri par nom en sous-dossiers~~ — **résolu (2026-10-17)** | [features.md FN-04](features.md#4-tri) | En mode sous-dossiers, le tri par nom s'applique au chemin relatif (`rel`) → fichiers regroupés par dossier. Non récursif inchangé. |
| 6 | ~~Renommage et extension~~ — **résolu (2026-10-17)** | [features.md FN-13](features.md#fn-13-renommage-touche-r) | L'extension d'origine est désormais **toujours** conservée (ajoutée sauf si déjà présente, casse normalisée). Un point décoratif (`budget.2024`) n'écrase plus le `.jpg`. Changer l'extension via le renommage n'est plus possible. |
| 7 | ~~Fichiers cachés et liens symboliques~~ — **résolu (2026-10-17)** | [features.md FN-05](features.md#fn-05-sous-dossiers) | Deux toggles ajoutés au panneau ⚙ Préférences : « Show hidden files » et « Follow symbolic links », **OFF par défaut** (cachés exclus, liens non suivis). Les boucles de symlinks sont évitées (`fs.realpath`). |
| 8 | ~~Focus sur la liste « Sort »~~ — **résolu (2026-10-17)** | [features.md FN-17](features.md#10-raccourcis-clavier) | Après un changement de Sort / Subfolders / Maximize, le focus revient à la grille (`blur()`) → les flèches naviguent aussitôt dans les vignettes. |
| 9 | ~~« Ouvrir avec » d'une extension inconnue~~ — **résolu (2026-10-17)** | [features.md FN-15](features.md#9-ouverture-depuis-le-système-ouvrir-avec) | Une extension non-média est désormais refusée (toast « Unsupported file type »), au lieu d'être classée en photo et ajoutée définitivement aux types (`isKnownExt`). |
| 10 | ~~Plein écran des formats non décodables~~ — **résolu (2026-10-17)** | [features.md FN-08](features.md#6-visionneuse-plein-écran-photos) | Un tiff/heic en plein écran affiche désormais une notice centrée « Cannot preview · EXT » au lieu d'une image cassée (`showViewerError`). |
| 11 | Purge du cache de vignettes | [config.md §4.3](config.md#43-nettoyage) | Aucune purge n'est implémentée ; le cache croît sans limite. Une purge est-elle souhaitée ? |
| 12 | ~~Formats `tif` et `heic`~~ — **résolu (2026-10-17)** | [config.md §2.4](config.md#24-types-de-fichiers) | `tiff`/`tif`/`heic` (non décodables par Chromium) retirés du menu Types **et** des associations système. Menu, associations, code et README désormais alignés ; prefs nettoyées au chargement. |
| 13 | Mise à jour automatique | [build-and-deploy.md §5.4](build-and-deploy.md#54-mise-à-jour-automatique) | `latest-mac.yml` est généré mais rien ne le consomme. Une mise à jour automatique est-elle prévue ? |

### B. Bugs ou risques probables à reproduire

| # | Sujet | Où | Détail |
|---|---|---|---|
| 14 | Fermeture par fond bloquée | [features.md FN-09](features.md#fn-09-zoom-et-déplacement) | `dragMoved` n'est réinitialisé que si l'image est zoomée. Après un glisser suivi d'un retour à l'ajustement, un clic sur le fond peut ne pas fermer la visionneuse. |
| 15 | ~~Réponses de listage concurrentes~~ — **résolu (2026-10-17)** | [architecture.md §6.4](architecture.md#64-points-de-vigilance) | Jeton de requête (`listSeq`) sur `loadList` : une réponse obsolète est ignorée au lieu d'écraser la liste. `try/catch` ajouté. |
| 16 | Chemins non restreints côté processus principal | [architecture.md §9](architecture.md#9-sécurité-et-isolation) | `fs:list`, `file:trash`, `file:rename`, `file:open` acceptent tout chemin fourni par le renderer. Risque limité (renderer local), mais aucune restriction au dossier choisi. |
| 17 | Sandbox du renderer non explicite | [architecture.md §9](architecture.md#9-sécurité-et-isolation) | Le preload semble sandboxé (défaut Electron 31), mais le réglage n'est pas déclaré. |
| 18 | `read` et `set -e` dans le script Ubuntu | [build-and-deploy.md §3.2](build-and-deploy.md#32-installation-par-script-recommandée) | Une entrée fermée fait échouer le script au lieu de prendre la valeur par défaut. Le script est donc interactif uniquement. |

### C. Divergences entre documentation, code et artefacts

| # | Sujet | Où | Détail |
|---|---|---|---|
| 19 | ~~DMG arm64 absent~~ — **résolu (2026-10-17)** | [build-and-deploy.md §4.3](build-and-deploy.md#43-artefacts-et-architecture) | Les 3 artefacts 1.1.0 sont bien publiés sur GitHub Releases (`arm64.dmg`, `intel.dmg`, `amd64.deb`), distincts et valides. Le `dist/` local n'en contenait que la sortie x64 (état partiel). Suffixes `-intel`/`-arm64` posés manuellement à l'upload ; nommage auto `-x64`/`-arm64` depuis le commit `8048843`. |
| 20 | ~~Artefacts Linux absents~~ — **résolu (2026-10-17)** | [build-and-deploy.md §6](build-and-deploy.md#6-matrice-de-cibles) | Le `.deb` (`media-sorter_1.1.0_amd64.deb`) est présent sur GitHub Releases. Il est seulement absent du `dist/` local (build Linux fait sur une autre machine). |
| 21 | Dossier de données utilisateur | [config.md §5](config.md#5-chemins-système) | Le paquet n'a pas de `productName` : le chemin probable est `media-sorter` et non `Media Sorter`. À vérifier au lancement. |
| 22 | Icône et clés `Info.plist` | [build-and-deploy.md §4.4](build-and-deploy.md#44-métadonnées-du-bundle-infoplist) | Icône par défaut d'Electron ; permissions caméra, micro, Bluetooth et `NSAllowsArbitraryLoads` héritées d'Electron. Icône propre et nettoyage voulus ? |
| 23 | Procédure de release | [build-and-deploy.md §5.3](build-and-deploy.md#53-procédure-de-sortie-déduite-de-lhistorique) | Aucun script de release. La procédure est déduite de l'historique ; à valider. |
| 24 | ~~README obsolète~~ — **résolu (2026-10-17)** | [build-and-deploy.md §7](build-and-deploy.md#7-points-dattention) | Version/artefacts corrigés (GitHub Releases + 3 packages), clic-lecture vidéo documenté, et `tiff`/`tif`/`heic` retirés partout (plus d'écart à lister). |
| 25 | Affichage des performances | [architecture.md §6.2](architecture.md#62-rendu-de-la-grille) | Pas de virtualisation de la grille. Tenue sur de grands dossiers non mesurée. |

## Hors périmètre actuel

- Windows : aucune configuration de build ni de test.
- Déplacement, copie et classement de fichiers.
- Annulation des actions.
- Lecture vidéo intégrée.
- Tests automatisés et linting.
