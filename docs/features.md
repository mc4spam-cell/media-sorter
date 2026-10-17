# Spécifications fonctionnelles

> Chaque fonctionnalité porte un identifiant (`FN-xx`) pour faciliter la validation.
> Références `fichier:ligne` relatives à `/Users/mc/media-sorter`.
> Les points **[à confirmer]** sont des comportements dont l'intention n'est pas explicite dans le code.

## 1. Vue générale de l'interface

Barre supérieure (`renderer/index.html:13-43`), de gauche à droite :

| Élément | id | Fonction |
|---|---|---|
| Bouton « 📁 Open folder… » | `pickBtn` | Choix du dossier (FN-01) |
| Onglets **Photos** / **Videos** | `tabPhotos`, `tabVideos` | Changement de mode (FN-02) |
| Liste « Sort » | `sortBy` | Nom ou date de modification (FN-04) |
| Bouton ↑ / ↓ | `sortDir` | Sens du tri (FN-04) |
| Case « Subfolders » | `recursive` | Scan récursif (FN-05) |
| Case « Maximize » | `maximize` | Agrandissement en plein écran (FN-08) |
| « Types ▾ » | `typesBtn` | Extensions prises en compte (FN-03) |
| « ⓘ » | `helpBtn` | Aide des raccourcis (FN-18) |

Sous la barre : chemin du dossier courant (`folderPath`, « No folder selected » au départ) et compteur (`count`, par exemple « 42 photos »). La grille (`grid`) occupe le reste de la fenêtre.

## 2. Ouverture et navigation dans les dossiers

### FN-01 Ouvrir un dossier
- Le bouton ouvre le sélecteur natif « dossier » (`main.js:143-147`).
- Annulation : aucun changement.
- Choix : le chemin devient le dossier de travail, la liste est rechargée, la sélection revient au premier élément (`renderer/renderer.js:114-116`, `132`).
- Le dossier n'est **pas** mémorisé entre les lancements (`state.folder` démarre à `null`).

### FN-02 Modes Photos et Videos
- Deux onglets. Le mode actif détermine les extensions proposées et le comportement de clic.
- Le changement de mode ferme la visionneuse, reconstruit le menu des types et recharge la liste (`renderer/renderer.js:506-514`).
- Le mode n'est pas mémorisé : l'application démarre toujours en **Photos** (`renderer/renderer.js:24`).

## 3. Types de fichiers

### FN-03 Extensions prises en charge
Définies dans `TYPE_SETS` (`renderer/renderer.js:16-19`) :

| Mode | Extensions par défaut | Extensions « autres types » (cochées à la demande) |
|---|---|---|
| Photos | `jpg`, `jpeg`, `png`, `webp` | `gif`, `bmp`, `avif`, `tiff`, `tif`, `heic` |
| Videos | `avi`, `mpg`, `mpeg`, `mkv` | `mp4`, `mov`, `m4v`, `webm`, `wmv`, `flv`, `3gp` |

- La correspondance est insensible à la casse (`main.js:152`, `169`).
- Le menu **Types ▾** (`renderer/renderer.js:580-600`) propose une case par extension, en deux groupes : « Default » et « Other types ». Chaque changement enregistre les préférences et recharge la liste.
- Une extension décochée n'apparaît plus dans la liste ; décocher toutes les extensions donne une liste vide.
- Les formats que Chromium ne sait pas afficher (ex. `tiff`, `heic`) sont listés et triés, avec un badge à la place de l'aperçu (voir FN-06).
- **[à confirmer]** : le README ne mentionne pas `tif` parmi les formats supplémentaires photo, alors que le code l'inclut (`renderer/renderer.js:17`).

## 4. Tri

### FN-04 Ordre de la liste
- Critères : **Name** (nom de fichier) ou **Date modified** (`mtimeMs`) ; sens ascendant (↑) ou descendant (↓).
- Le tri est effectué par le processus principal (`main.js:180-184`) :
  - nom : `localeCompare` avec `numeric: true`, donc `img2` précède `img10` ;
  - date : tri numérique sur `mtimeMs`, du plus ancien au plus récent en ascendant.
- Le changement de critère ou de sens recharge la liste et **remet la sélection au premier élément** (`renderer/renderer.js:132`).
- Préférences sauvegardées : `sortBy`, `sortDir` (voir [config.md §3](config.md#3-préférences-persistées)).
- **[à confirmer]** : en mode sous-dossiers, le tri par nom compare le **nom de fichier seul** (`a.name`), et non le chemin relatif. Des fichiers homonymes de sous-dossiers différents sont donc mélangés (`main.js:182-183`).

### FN-05 Sous-dossiers
- Case **Subfolders** : scan récursif de toute l'arborescence (`main.js:165`).
- Quand la case est cochée, chaque vignette affiche le **chemin relatif** au dossier choisi (`renderer/renderer.js:149`) ; l'infobulle donne toujours le chemin complet (`renderer/renderer.js:150`).
- Les sous-dossiers illisibles (droits) sont ignorés sans erreur (`main.js:158-161`).
- Les liens symboliques ne sont **pas** suivis : une entrée qui n'est ni dossier ni fichier régulier est ignorée (`main.js:162-168`). **[à confirmer]**.
- Les fichiers cachés (noms commençant par un point) ne sont pas exclus explicitement et apparaissent s'ils ont une extension retenue. **[à confirmer]**.

## 5. Vignettes (grille)

### FN-06 Grille photo
- Chaque photo est affichée en vignette via une URL `file://` (`renderer/renderer.js:156-166`).
- Si Chromium ne peut pas afficher le fichier, un badge affiche l'extension en majuscules (ex. `TIFF`, `HEIC`). Le fichier reste listé et sélectionnable.
- Le libellé sous la vignette est le nom du fichier (ou le chemin relatif en mode sous-dossiers).

### FN-07 Vignettes vidéo : stop-motion
Chaque vidéo a une vignette animée (`renderer/renderer.js:166-187`, `main.js:374-435`).

**Échantillonnage** :
- Si la durée est **supérieure à 60 s** : échantillonnage **adaptatif** d'au plus **20 images** réparties sur **toute** la durée. L'intervalle vaut `max(60 s, durée / 20)` : une image toutes les 60 s pour les clips ≤ 20 min (cadence inchangée), puis un pas élargi au-delà (ex. 30 min → 90 s, 2 h → 6 min) pour couvrir ~95 % de la vidéo (`main.js`, constantes `FRAME_INTERVAL_SEC` / `MAX_FRAMES`). *(Depuis le 2026-10-17 ; auparavant, pas fixe de 60 s → seules les ~20 premières minutes étaient représentées.)*
- Si la durée est **inférieure ou égale à 60 s** ou **inconnue** : une seule image, prise à `min(1 s, durée/2)` ; sans durée connue, à 1 s (`main.js:395-398`). Il n'y a alors pas d'animation.
- Chaque image est extraite par un appel `ffmpeg` avec seek rapide avant l'entrée (`-ss t -i`), une seule frame, redimensionnée à 400 px de large (`main.js:403-413`).
- Si aucune image n'est obtenue, une tentative sans seek prend la première frame (`main.js:422-431`).

**Lecture** :
- La première image est affichée, puis les images défilent en boucle, **une par seconde** (`renderer/renderer.js:234-242`).
- Les vignettes sont calculées **au plus 2 à la fois** (`renderer/renderer.js:194`).
- Le badge « VIDEO » est affiché sur chaque vignette vidéo ; la classe `loading` est retirée à réception des images.
- Quand l'extraction **n'aboutit à aucune image** — qu'elle lève une erreur IPC **ou** qu'elle renvoie une liste vide (fichier corrompu, codec non géré par le ffmpeg embarqué, vidéo vide) — le badge devient **« NO PREVIEW »** et le spinner s'arrête, via le helper `markNoPreview` (`renderer/renderer.js`). *(Résolu le 2026-10-17 ; auparavant le cas « 0 image sans erreur » laissait la vignette en chargement indéfini.)*

**Cache** : les images extraites sont conservées sur disque ; voir [config.md §4](config.md#4-cache-des-images-vidéo). Une vidéo déjà en cache garde ses images (clé `chemin:mtime` inchangée) jusqu'à modification du fichier ou purge ; le nouvel échantillonnage ne s'applique donc qu'aux extractions suivantes.

## 6. Visionneuse plein écran (photos)

### FN-08 Affichage
- Ouverte par **clic** sur une vignette photo, ou par **Entrée** (`renderer/renderer.js:178-180`, `716-717`).
- Fond noir, image centrée, légende « nom · position/total » en bas (`renderer/renderer.js:305-311`).
- **[à confirmer]** : le repli « badge d'extension » ne s'applique qu'à la grille (`renderer/renderer.js:159-165`). Un format non décodable (tiff, heic) ouvert en plein écran n'affiche qu'une image cassée, sans indication.
- Quitter : **Échap** ou clic sur le fond noir (pas sur l'image) (`renderer/renderer.js:653-655`).
- Ajustement (`applyFit`, `renderer/renderer.js:370-378`) :
  - par défaut, l'image est réduite pour tenir dans la fenêtre, **sans jamais dépasser sa taille native** ;
  - avec **Maximize** coché, elle est agrandie jusqu'à remplir la fenêtre en conservant les proportions ;
  - l'ajustement est recalculé au redimensionnement de la fenêtre et au changement de l'option.
- Le réglage Maximize est mémorisé (`renderer/renderer.js:628-632`).

### FN-09 Zoom et déplacement
- **Pincement** du pavé tactile (transmis comme `Ctrl` + molette) ou **molette** : zoom centré sur le curseur (`renderer/renderer.js:392-400`). Facteur : `exp(-deltaY × 0.01)` avec Ctrl, `exp(-deltaY × 0.0015)` sans Ctrl.
- Zoom minimal : 1 (ajustement). Zoom maximal : **8×** (`renderer/renderer.js:317`).
- **Glisser** pour déplacer l'image lorsqu'elle est zoomée (`renderer/renderer.js:410-434`).
- **Double-clic** ou touche **0** : retour à l'ajustement (`renderer/renderer.js:437-440`, `723-724`).
- Le zoom est réinitialisé à chaque changement d'image (`renderer/renderer.js:308`).

**[à confirmer]** : probable bug. `dragMoved` n'est réinitialisé que dans le `mousedown` quand l'image est zoomée (`renderer/renderer.js:410-413`). Après un glisser suivi d'un retour à l'ajustement, un clic sur le fond peut ne pas fermer la visionneuse. À reproduire.

### FN-10 Navigation dans la visionneuse
- **← / →** (aussi **↑ / ↓**) : photo précédente / suivante, la visionneuse se met à jour (`renderer/renderer.js:257-265`).
- Les flèches sont interceptées (`preventDefault`) : elles ne font pas défiler la page.

## 7. Lecture des vidéos

### FN-11 Lecture externe
- **Clic** sur une vignette vidéo, ou **Entrée**, ouvre le fichier dans le **lecteur par défaut du système** (`renderer/renderer.js:282-290`).
  - Linux : `xdg-open` avec un environnement assaini (`main.js:274-278`).
  - macOS : `shell.openPath` (`main.js:280`).
- En cas d'échec : message « Cannot open video: … ».
- Aucune lecture n'est intégrée à l'application.

## 8. Actions sur le fichier courant

### FN-12 Mise à la corbeille (touche X)
- Effet immédiat, **sans boîte de confirmation** (`renderer/renderer.js:443-469`).
- Le fichier part dans la **corbeille du système** via le paquet `trash` (`main.js:189-193`) :
  - macOS : binaire `macos-trash`, donc la corbeille du Finder ;
  - Linux : spécification freedesktop (répertoire XDG `Trash`).
- Après succès : l'élément disparaît de la liste, le compteur est mis à jour, un message « Trashed <nom> » s'affiche, et la sélection reste à la même position (ou passe à la précédente si c'était la dernière).
- S'il ne reste plus rien : la visionneuse se ferme.
- En cas d'échec : message « Trash failed: … », aucun changement dans la liste.
- Les frames en cache du fichier ne sont **pas** supprimées (voir [config.md §4](config.md#4-cache-des-images-vidéo)).
- Pas d'annulation dans l'application ; la récupération se fait depuis la corbeille.
- **[à confirmer]** : l'absence de confirmation est-elle voulue, compte tenu de la touche X accessible d'un seul geste ?

### FN-13 Renommage (touche R)
- Une fenêtre modale « Rename file » s'ouvre, pré-remplie avec le nom complet. La partie avant le **dernier point** est présélectionnée, pour ne modifier que le nom de base (`renderer/renderer.js:472-481`).
- **Entrée** valide, **Échap** annule, ou boutons « Cancel » / « Rename ». Un clic à l'extérieur ne ferme pas la fenêtre.
- Règles appliquées par le processus principal (`main.js:196-217`) :
  - la saisie est nettoyée ; un nom vide provoque l'erreur « Empty name » ;
  - les séparateurs `/` et `\` sont remplacés par `_` (pas de déplacement involontaire) ;
  - si le nom saisi n'a **pas** d'extension, l'extension d'origine est ajoutée. Une extension saisie est conservée telle quelle ;
  - si le nom cible existe déjà, un suffixe ` (1)`, ` (2)`… est ajouté avant l'extension ;
  - un nom identique à l'original ne fait rien.
- Après succès : message « Renamed to <nouveau nom> », rechargement de la grille (les frames vidéo sont recalculées car la clé de cache dépend du chemin).
- En cas d'échec : message « Rename failed: … ».
- **[à confirmer]** : un nom contenant un point (ex. `vacances.2026`) est considéré comme ayant déjà une extension, et l'extension d'origine n'est donc pas ajoutée.

### FN-14 Éditeurs externes
| Touche | Mode | Application | macOS | Linux |
|---|---|---|---|---|
| **G** | Photos | GIMP | `open -a GIMP <fichier>` | binaire `gimp`, détaché |
| **S** | Vidéos | Shotcut | `open -a Shotcut <fichier>` | binaire `shotcut`, détaché |

- Définition : `EXTERNAL_APPS` (`main.js:287-290`).
- Succès : message « Opening in <app>… ».
- Application absente : message « Cannot open in <app>: … ».
- Les touches ne font rien dans le mode qui ne les concerne pas.
- Le README précise que les éditeurs doivent être installés ; ffmpeg, lui, est embarqué.

## 9. Ouverture depuis le système (Ouvrir avec)

### FN-15 Fichier passé à l'application
Les déclencheurs sont :
- **macOS** : l'événement `open-file` (`main.js:99-103`) ;
- **Linux / autres** : un argument de ligne de commande au lancement (`main.js:123`) ou une seconde instance (`main.js:111-118`) ;
- Les URI `file://` sont acceptées (`main.js:58-70`) : les gestionnaires de fichiers passent parfois une URI au lieu d'un chemin.

Comportement côté interface (`renderer/renderer.js:540-574`) :
1. l'extension du fichier est ajoutée aux types actifs du mode concerné si elle ne l'était pas, et les préférences sont sauvegardées ;
2. le mode correspondant (Photos ou Videos) est activé ;
3. le dossier parent devient le dossier de travail, et la liste est chargée ;
4. le fichier est sélectionné (par chemin complet, sinon par nom) ;
5. en Photos, la visionneuse s'ouvre ; en Videos, le fichier est sélectionné et visible, sans être lancé ;
6. si le fichier n'est pas trouvé dans la liste, le message « File not found in folder: … » s'affiche.

**[à confirmer]** : une extension inconnue passée par ce chemin (ex. `.txt`) est classée en Photos et ajoutée à la liste des extensions photo. Les associations de fichiers déclarées ne concernent que les images (`package.json`, section `build.fileAssociations`), donc le cas est théorique.

### FN-16 Instance unique
- Une seule fenêtre à la fois (`main.js:107`).
- Une seconde instance lancée avec un fichier transmet ce fichier à la fenêtre existante, qui est restaurée et mise au premier plan (`main.js:111-118`).
- Sous macOS, la fenêtre est recréée au clic sur l'icône si elle a été fermée (`main.js:125-127`).

## 10. Raccourcis clavier

### FN-17 Table des raccourcis

| Touche | Mode | Action | Réf. |
|---|---|---|---|
| **←** / **↑** | tous | Élément précédent | `renderer/renderer.js:710-714` |
| **→** / **↓** | tous | Élément suivant | `renderer/renderer.js:705-709` |
| **Entrée** | Photos | Ouvrir la visionneuse (sans effet si déjà ouverte) | `renderer/renderer.js:715-719` |
| **Entrée** | Videos | Lancer dans le lecteur système | `renderer/renderer.js:718` |
| **Échap** | tous | Fermer la visionneuse (sans effet ailleurs) | `renderer/renderer.js:720-722` |
| **0** | visionneuse | Réinitialiser le zoom | `renderer/renderer.js:723-725` |
| **X** | tous | Mettre à la corbeille | `renderer/renderer.js:726-729` |
| **R** | tous | Renommer | `renderer/renderer.js:730-734` |
| **G** | Photos | Ouvrir dans GIMP | `renderer/renderer.js:735-738` |
| **S** | Videos | Ouvrir dans Shotcut | `renderer/renderer.js:739-742` |

Règles de garde (`renderer/renderer.js:696-703`) :
- Si l'aide est ouverte, seule **Échap** est traitée (elle la ferme).
- Si la fenêtre de renommage est ouverte, le gestionnaire global ne fait rien.
- Si le focus est dans un champ `INPUT`, `SELECT` ou `TEXTAREA` (liste de tri, cases à cocher du menu Types), les touches ne sont pas interceptées.

**Validé (2026-10-17)** : les touches **ne vérifient pas les modificateurs** (`Ctrl`, `Cmd`, `Alt`, `Fn`). `Cmd+X`, `Ctrl+R`, etc. déclenchent donc la même action que la touche seule. **Comportement souhaité** : il rend les raccourcis robustes quand les affectations de `Ctrl`/`Cmd`/`Option`/`Fn` diffèrent (machines virtuelles, macOS vs Linux natif), où exiger une combinaison exacte échouerait selon l'environnement.

**[à confirmer]** :
- Après une modification de la liste « Sort », le focus reste sur ce champ et les flèches agissent sur la liste déroulante, pas sur la grille, tant qu'on ne clique pas sur la grille. À valider.
- Le README indique « Esc back » ; en mode grille, Échap ne fait rien, ce qui est cohérent avec le code.

## 11. Aide

### FN-18 Fenêtre des raccourcis
- Ouverte par le bouton **ⓘ** ; fermée par **Close**, **Échap** ou un clic à l'extérieur (`renderer/renderer.js:644-649`, `698`).
- Liste les raccourcis de la table FN-17, dans l'ordre de l'interface (`renderer/index.html:68-85`).
- Pendant son ouverture, les autres touches sont ignorées.

## 12. Taille des vignettes

### FN-19 Pincement de la grille
- **Ctrl + molette** (pincement du pavé tactile) agrandit ou réduit les vignettes ; la molette seule fait défiler la grille (`renderer/renderer.js:678-688`).
- Facteur : `exp(-deltaY × 0.01)` sur la taille courante.
- Bornes : **110 px** minimum, **480 px** maximum (`renderer/renderer.js:659-660`).
- Taille par défaut : **200 px** (valeur de repli dans `styles.css:173-174`).
- La taille est mémorisée (`tileSize`, voir [config.md §3](config.md#3-préférences-persistées)).

## 13. Persistance et messages

- Messages temporaires (« toast ») : affichés 1,8 s en bas de l'écran (`renderer/renderer.js:90-95`).
- Préférences : voir [config.md §3](config.md#3-préférences-persistées).
- Aucune journalisation applicative n'est écrite sur disque.

## 14. Comportements non couverts par le code

Ces points sont absents de l'application ; ils sont listés pour éviter toute ambiguïté :

- aucun déplacement ni copie de fichier ;
- aucune confirmation avant suppression ;
- aucune annulation ;
- aucun raccourci de lecture vidéo intégrée ;
- aucune recherche ni filtre par nom (hors extensions) ;
- aucune action sur plusieurs fichiers à la fois (sélection multiple) ;
- aucune mémorisation du dossier ouvert ni de la position de la sélection.
