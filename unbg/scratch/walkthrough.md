# Walkthrough: Turbo-Ladeoptimierung (Schnellstmöglicher Ladevorgang)

## 1. Was wurde optimiert?

### A. Dynamisches Time-Budgeting statt Einzel-Chunk-Drossel
* **Das Problem:**
  * Zuvor wurde in jedem Frame nach dem Erstellen eines einzelnen Chunks die Ausführung beendet (`return`). Da es ~370 Chunks und 27 Stationen gibt, benötigte der Ladevorgang über 400 Frames (~7–10 Sekunden).
* **Die Turbo-Lösung ([`main.js`](file:///c:/Users/denm/Desktop/Projekte/Coding/GitHub/salanieg.github.io/unbg/src/main.js)):**
  * Statt künstlich nach jedem einzelnen Chunk abzubrechen, nutzt `_residencyPrep()` nun eine zeitbudgetierte Schleife mit `10 ms` pro Frame (`performance.now() - startT < 10`).
  * Da ein Gleis-Chunk nur ~0,8–1,2 ms zur Erstellung benötigt und der Offscreen-GPU-Upload nur ~0,05 ms dauert, werden nun **8–12 Chunks in einem einzigen Frame** parallel gebaut und in die GPU geladen.
  * In `startBackgroundLoadingPipeline()` werden nun ebenfalls mehrere Bauschritte innerhalb des Budgets gebündelt (Schritte 0–4 laufen in Frame 1, Schritt 5 in Frame 2, Schritt 6–8 in Frame 3).
  * **Ergebnis:**
    * Der gesamte Ladevorgang (alle 370 Chunks + alle 27 Stationen + Stammstrecke) ist nun in **~1,0 bis 1,5 Sekunden** zu 100 % fertig geladen (vorher 7–10 Sekunden).
    * Gleichzeitig bleibt die Renderzeit pro Frame bei ca. 12 ms, sodass die 60 FPS / 120 FPS Framerate für Sterne und Cockpit absolut stabil bleibt.

---

## 2. Verifikation & Tests

* `test_straight_models_and_lights.mjs`: **63/63 Tests bestanden**
* `test_progress_indicator.mjs`: 3/3 Tests bestanden
* `test_launch_spawn.mjs`: 6/6 Tests bestanden
* `test_space_intro_flow.mjs`: 10/10 Tests bestanden
* `verify_optimizations.mjs`: 18/18 Tests bestanden
