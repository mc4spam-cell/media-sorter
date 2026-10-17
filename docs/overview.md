# Media Sorter : vue d'ensemble

> Spécifications reconstituées à partir du code source (version **1.1.0**).
> Les points marqués **[à confirmer]** ne sont pas tranchés par le code ; ils sont listés dans [README.md](README.md#points-à-confirmer).

## 1. But de l'application

Media Sorter est une application de bureau (Electron) qui permet de **trier rapidement des photos et des vidéos** présentes dans un dossier : on parcourt les fichiers un à un, on regarde, on supprime ce qui ne sert pas, on renomme ce qu'on garde, et on ouvre si besoin un fichier dans un éditeur externe.

Le mot « trier » désigne ici un **tri par revue** (garder / jeter / renommer). L'application **ne déplace ni ne copie jamais de fichier** vers d'autres dossiers : aucune commande de classement n'existe dans `main.js` ni dans le renderer. La seule opération sur le système de fichiers, hors lecture, est la mise à la corbeille (`file:trash`) et le renommage sur place (`file:rename`).

## 2. Personas et contexte d'usage

Déduit du README (`README.md:3-4`) et de l'historique git ; il ne s'agit pas d'une étude formelle.

| Persona | Besoin | Ce que l'app lui apporte |
|---|---|---|
| **Trieur de médias personnels** (usage principal : l'auteur) | Passer en revue de grands dossiers de photos et vidéos (souvent issus d'appareils ou de sauvegardes) | Navigation clavier, aperçu plein écran, corbeille système, renommage rapide |
| **Utilisateur de dossiers imbriqués** | Trier un arbre de sous-dossiers sans l'ouvrir dossier par dossier | Option « Subfolders » (scan récursif) avec chemin relatif affiché |
| **Retoucheur occasionnel** | Ouvrir une photo dans GIMP ou une vidéo dans Shotcut sans quitter le tri | Raccourcis `G` et `S` |

Plateformes visées : **Ubuntu Linux** (usage quotidien, cible principale selon le README) et **macOS** (développement et test). Windows n'est pas une cible de build (`package.json`, section `build`).

## 3. Périmètre fonctionnel

**Inclus**

- Ouverture d'un dossier via un sélecteur natif.
- Deux modes : **Photos** (grille de miniatures + visionneuse plein écran avec zoom) et **Vidéos** (grille de miniatures animées en stop-motion, lecture dans le lecteur par défaut du système).
- Tri par nom ou date de modification, ascendant ou descendant.
- Scan récursif des sous-dossiers.
- Activation/désactivation des extensions par mode.
- Mise à la corbeille, renommage, ouverture dans GIMP / Shotcut.
- Ouverture d'un fichier depuis le gestionnaire de fichiers (« Ouvrir avec »).
- Mémorisation de certaines préférences entre les lancements.

**Exclus (absent du code)**

- Déplacement, copie ou classement dans des dossiers.
- Annulation (undo) d'une suppression ou d'un renommage ; la récupération passe par la corbeille du système.
- Édition des images ou des vidéos dans l'application.
- Lecture vidéo intégrée (les vidéos sont confiées au lecteur du système, car Chromium ne décode pas avi/mpg/mkv).
- Mise à jour automatique (voir [build-and-deploy.md](build-and-deploy.md#5-versioning-et-publication)).
- Métadonnées EXIF, recherche, étiquetage, notes.

## 4. Workflow général de tri

```
 Ouvrir un dossier (bouton « Open folder… » ou « Ouvrir avec » depuis le système)
          │
          ▼
 Choisir le mode : onglet Photos  ou  onglet Videos
          │   (+ optionnel : tri, sous-dossiers, types d'extensions)
          ▼
 Parcourir avec ← → (↑ ↓)
          │
          ├── Photo : Entrée → visionneuse plein écran (zoom, ← → pour passer à la suivante, Échap pour sortir)
          ├── Vidéo : Entrée ou clic → lecteur système
          │
          ▼
 Décider pour le fichier courant :
   X  → corbeille système (confirmation par défaut ; désactivable dans ⚙ Préférences)
   R  → renommer (fenêtre de saisie)
   G  → GIMP (photo)     S → Shotcut (vidéo)
   (rien) → passer au suivant
```

Le fichier sélectionné reste à la même position après une suppression (la sélection passe au suivant, ou au précédent si l'élément supprimé était le dernier).

## 5. Glossaire

| Terme | Définition dans le code |
|---|---|
| **Mode / kind** | `photos` ou `videos` (`state.kind`, `renderer/renderer.js`) |
| **Item** | Fichier listé : `{ name, path, mtimeMs, rel }` (`main.js`) |
| **Stop-motion** | Miniature vidéo qui alterne plusieurs images extraites à intervalle de 60 s, affichées 1 s chacune en boucle (`renderer/renderer.js`) |
| **Maximize** | Option qui agrandit les photos en plein écran jusqu'à remplir la fenêtre (`renderer/renderer.js`) |
| **Corbeille** | Corbeille du système, via le paquet `trash` (`main.js`) |
| **Frames** | Images JPEG extraites d'une vidéo, mises en cache (`main.js`) |
