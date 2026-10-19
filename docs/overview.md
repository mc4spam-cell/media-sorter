# Media Sorter : vue d'ensemble

> Spécifications reconstituées à partir du code source (version **1.3.0**).
> Les pistes d'amélioration encore ouvertes sont listées dans [README.md](README.md#évolutions-possibles).

## 1. But de l'application

Media Sorter est une application de bureau (Electron) qui permet de **trier rapidement des photos et des vidéos** présentes dans un dossier : on parcourt les fichiers un à un, on regarde, on supprime ce qui ne sert pas, on renomme ce qu'on garde, et on ouvre si besoin un fichier dans un éditeur externe.

Le mot « trier » désigne ici un **tri par revue** (garder / jeter / renommer / ranger). Les opérations sur le système de fichiers, hors lecture, sont : la mise à la corbeille (`file:trash`, via un staging annulable), le renommage sur place (`file:rename`, `file:renameBatch`) et, depuis la 1.2.0, le déplacement ou la copie vers un dossier choisi (`file:transfer`). Chacune peut s'appliquer à une sélection de plusieurs fichiers et s'annule (10 dernières actions).

## 2. Personas et contexte d'usage

Déduit du README (introduction) et de l'historique git ; il ne s'agit pas d'une étude formelle.

| Persona | Besoin | Ce que l'app lui apporte |
|---|---|---|
| **Trieur de médias personnels** (usage principal : l'auteur) | Passer en revue de grands dossiers de photos et vidéos (souvent issus d'appareils ou de sauvegardes) | Navigation clavier, aperçu plein écran, corbeille annulable, renommage rapide (aussi en masse), sélection multiple, déplacement/copie vers un dossier |
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
- Sélection multiple (Cmd/Ctrl-clic, Shift-clic, A).
- Rotation des photos de 90° (← / →), enregistrée sans perte dans le fichier.
- Mise à la corbeille, renommage (y compris ajout d'un préfixe en masse), déplacement et copie vers un dossier, ouverture dans GIMP / Shotcut.
- Annulation des 10 dernières actions (Z ; Cmd/Ctrl+touche = touche seule).
- Ouverture d'un fichier depuis le gestionnaire de fichiers (« Ouvrir avec »).
- Mémorisation de certaines préférences entre les lancements.

**Exclus (absent du code)**

- Classement assisté (dossiers favoris, destinations en un geste) : déplacer/copier passe par le sélecteur de dossier.
- « Refaire » après une annulation, et historique d'annulation après un redémarrage.
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
 Parcourir avec ↑ ↓   (← → font tourner la photo de 90°)
          │
          ├── Photo : Entrée ou double-clic → visionneuse plein écran (zoom, ↑ ↓ pour passer à la suivante, ← → pour la tourner, Échap pour sortir)
          ├── Vidéo : Entrée ou double-clic → lecteur système
          ├── Sélection multiple : Cmd/Ctrl-clic, Shift-clic, Shift+↑↓, A
          │
          ▼
 Décider pour le fichier courant ou la sélection :
   X  → corbeille (confirmation par défaut ; désactivable dans ⚙ Préférences)
   R  → renommer (fenêtre de saisie ; plusieurs fichiers : ajouter un préfixe)
   ← / → → tourner de 90° (enregistré dans le fichier, sans perte)
   M / C → déplacer / copier vers un dossier
   G  → GIMP (photo)     S → Shotcut (vidéo)
   Z  → annuler la dernière action
   (rien) → passer au suivant
```

Après une suppression, le curseur se place à la position du premier fichier supprimé (donc sur le suivant, ou sur le dernier élément si la fin de liste a été supprimée).

## 5. Glossaire

| Terme | Définition dans le code |
|---|---|
| **Mode / kind** | `photos` ou `videos` (`state.kind`, `renderer/renderer.js`) |
| **Item** | Fichier listé : `{ name, path, mtimeMs, rel }` (`main.js`) |
| **Stop-motion** | Miniature vidéo qui alterne plusieurs images extraites à intervalle de 60 s, affichées 1 s chacune en boucle (`renderer/renderer.js`) |
| **Maximize** | Option qui agrandit les photos en plein écran jusqu'à remplir la fenêtre (`renderer/renderer.js`) |
| **Corbeille** | Corbeille du système, via le paquet `trash` (`main.js`), atteinte après un passage par le staging d'annulation (`lib/undo.js`) |
| **Staging** | Dossier caché `.media-sorter-staging/` créé à côté d'un fichier mis à la corbeille, tant que l'action reste annulable (`lib/undo.js`) |
| **Curseur / sélection** | Fichier courant (`state.cursor`) et ensemble des fichiers sélectionnés (`state.sel`) (`renderer/renderer.js`) |
| **Frames** | Images JPEG extraites d'une vidéo, mises en cache (`main.js`) |
