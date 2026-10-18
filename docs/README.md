# Media Sorter : documentation de spécifications

Spécifications fonctionnelles et techniques de **Media Sorter**, trieur de photos et vidéos en Electron.
Version documentée : **1.2.0**.

Ces documents sont **reconstitués à partir du code source** (`main.js`, `lib/`, `preload.js`, `renderer/`, `package.json`, `install-ubuntu.sh`) et des fichiers d'accompagnement (`README.md`, `CHANGELOG.md`).

## Sommaire

| Document | Contenu |
|---|---|
| [overview.md](overview.md) | But de l'application, personas, périmètre, workflow de tri, glossaire |
| [architecture.md](architecture.md) | Processus Electron, pont IPC, renderer, flux de données, dépendances, sécurité |
| [features.md](features.md) | Spécifications détaillées `FN-01` à `FN-23` : dossiers, types, tri, grille, vidéos, visionneuse, actions, raccourcis, annulation, sélection multiple, renommage en masse, déplacement/copie |
| [build-and-deploy.md](build-and-deploy.md) | Scripts npm, build macOS et Ubuntu, installation, versioning, publication |
| [config.md](config.md) | Constantes, préférences persistées, formats, cache, chemins système, variables d'environnement |
| [roadmap.md](roadmap.md) | Plan (réalisé) de la 1.2.0 : annulation, multi-sélection, renommage en masse, déplacement/copie |

Les références au code citent le **fichier** et le **symbole** concerné (fonction, constante) ; elles ne portent pas de numéro de ligne, qui dériverait à mesure que le code évolue.

## Conventions

- **`FN-xx`** : identifiant d'une fonctionnalité, pour citer un comportement de manière stable.

---

## Évolutions possibles

Pistes d'amélioration non encore réalisées, par effort croissant. Optionnelles : l'application est complète sans elles.

- **Icône propre de l'application.** L'app utilise aujourd'hui l'icône Electron par défaut ; déposer un `build/icon.icns` (et `build/icon.png` pour Linux) suffit à la personnaliser. Voir [build-and-deploy.md §4.4](build-and-deploy.md#44-métadonnées-du-bundle-infoplist).
- **Virtualisation de la grille.** Le coût images/CPU est déjà borné (lazy-loading des photos + `IntersectionObserver` pour les vidéos) ; ne rendre que les cellules visibles apporterait un gain supplémentaire si le seul nombre de nœuds DOM venait à peser sur de très grands dossiers. Voir [architecture.md §6.2](architecture.md#62-rendu-de-la-grille).
- **Mise à jour automatique.** `electron-builder` produit déjà `latest-mac.yml` ; brancher `electron-updater` permettrait des mises à jour en place (implique une application signée et notarisée). Voir [build-and-deploy.md §5.4](build-and-deploy.md#54-mise-à-jour-automatique).

## Hors périmètre actuel

- Windows : aucune configuration de build ni de test.
- Classement assisté (dossiers favoris, destinations en un geste) : la 1.2.0 se limite au sélecteur de dossier pour déplacer/copier.
- « Refaire » après une annulation.
- Lecture vidéo intégrée.
- Tests automatisés et linting.
