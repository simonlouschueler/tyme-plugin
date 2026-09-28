# Tyme-Importer für [Billy](https://usebilly.app)

Billy-Plugin: Zeiteinträge aus einem [Tyme](https://www.tyme-app.com)-Export als Rechnungsentwürfe anlegen — eine Rechnung pro Kategorie, Stundenpositionen nach Projekt/Aufgabe.

## Installation

1. Den Ordner `Tyme.billyplugin` bereithalten (aus dem Release-Zip entpacken).
2. In Billy: **Einstellungen → Plugins → Plugin hinzufügen…** und den Ordner wählen — oder hineinziehen.

## Nutzung

1. In Tyme die gewünschten Einträge als **JSON** exportieren.
2. In Billy: **Profile → Rechnungen importieren… → Tyme**.
3. Die JSON-Datei wählen. Billy erstellt Entwürfe zum Prüfen.

Gruppierung: **Kategorie** = Empfänger, **Projekt: Aufgabe** = Position. Stundensatz aus dem Export, sonst der Standard-Stundensatz des Billy-Profils (`rate: 0` zählt als nicht gesetzt). MwSt. kommt aus dem Profil. Bereits abgerechnete Einträge (`BILLED` / `PAID`) werden übersprungen, solange ungebuchte vorhanden sind.

CSV wird ebenfalls akzeptiert, falls du die Datei auswählen kannst (Dateifilter ist `.json`).

## Entwicklung

```bash
node fixtures/smoke-test.js
```

Siehe die [Billy Plugin Spec](https://usebilly.app/support/plugin-spec).
