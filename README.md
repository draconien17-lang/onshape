# ForgeCAD

CAO paramétrique dans le navigateur, inspirée d'Onshape, avec un **slicer intégré** : on modélise, on clique sur **Imprimer**, la pièce est découpée automatiquement et envoyée à l'imprimante (Anycubic Kobra 2 Pro par défaut).

## Démarrer

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # tests du slicer
npm run build    # version statique dans dist/
```

Node 20 ou plus récent.

## Ce que fait la v0.1

- **Esquisses 2D** sur les plans XY, XZ ou YZ : rectangles, cercles, trous, cotes modifiables au clavier.
- **Extrusion** d'une esquisse, avec arbre des fonctions : changer une cote recalcule la pièce.
- **Enregistrement** du projet en JSON (et sauvegarde automatique dans le navigateur).
- **Export STL**.
- **Slicer intégré** (JavaScript pur, sans dépendance) : couches, périmètres, remplissage, planchers et plafonds pleins, rétractation, ventilateur, estimation du temps et du filament.
- **G-code Marlin** réglé pour la Kobra 2 Pro : plateau 220 × 220 × 250 mm, buse 0,4 mm, PLA 200 °C / 60 °C, nivellement automatique (G29).
- **Envoi direct** vers une imprimante sous Klipper (API Moonraker), ou téléchargement du `.gcode` à copier sur la carte SD.

## Organisation

| Fichier | Rôle |
| --- | --- |
| `src/model.js` | Projet, fonctions (esquisse, extrusion), génération de la géométrie |
| `src/sketchEditor.js` | Éditeur d'esquisse 2D |
| `src/viewport.js` | Vue 3D (three.js) |
| `src/slicer.js` | Découpage en couches et génération du G-code |
| `src/printDialog.js` | Fenêtre « Imprimer » : réglages, découpe, envoi |
| `src/stl.js` | Export STL binaire |
| `src/main.js` | Interface et branchement du tout |

## Envoyer sur la Kobra 2 Pro

La Kobra 2 Pro d'origine n'a pas d'API réseau ouverte. Deux options :

1. **Carte SD ou USB** : télécharge le G-code et copie-le sur l'imprimante. Marche tout de suite.
2. **Klipper + Moonraker** : une fois l'imprimante sous Klipper, renseigne son adresse (par exemple `http://192.168.1.50:7125`) dans la fenêtre Imprimer. Dans `moonraker.conf`, ajoute l'adresse où tu héberges ForgeCAD à `cors_domains`.

Vérifie les valeurs par défaut (températures, rétractation, G29) à la première impression, et reste près de l'imprimante.

## Limites connues

- Pas encore de **coupe** (enlever de la matière) ni de congés : l'extrusion ajoute de la matière, et les trous se font dans l'esquisse.
- Pas de **contraintes** géométriques (parallèle, tangent, égal) dans les esquisses, seulement des cotes.
- Le slicer ne gère pas les **supports**, ni le « pont » entre deux surfaces. Les surfaces plafond internes ne sont pas détectées : le remplissage est plein sur les couches du haut et du bas seulement.
- Les décalages de contour sont simples : les parois très fines (moins de 2 largeurs de ligne) peuvent mal se découper.
- L'interface n'a pas été testée sur tous les navigateurs.

## Feuille de route

1. Noyau **OpenCascade** (`opencascade.js`) pour les opérations booléennes, congés, chanfreins et la coupe.
2. Solveur de **contraintes** d'esquisse (planegcs ou SolveSpace).
3. Esquisses sur les faces de la pièce, lignes, arcs, polygones.
4. Aperçu des couches du G-code dans la vue 3D.
5. Profils d'autres imprimantes.

## Déployer sur GitHub Pages

Le workflow `.github/workflows/deploy.yml` construit et publie le site à chaque push sur `main`. Dans les réglages du dépôt, onglet Pages, choisis « GitHub Actions » comme source.
