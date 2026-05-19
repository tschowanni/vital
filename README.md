# VITAL · Gesundheits-Monitor

Integriertes Self-Monitoring für POTS / ME/CFS — vollständig clientseitig, läuft als Progressive Web App im Browser.

## Module

| Modul | Inhalt | Frequenz |
|-------|--------|----------|
| **Morgen-Routine** | Blutdruck liegend + Puls + optional HRV (Polar H10) + optional Orthostat-BD-Test | täglich |
| **Abend-BD** | Schnell-Eingabe Blutdruck + Puls | täglich |
| **Tagebuch** | Schwindel/Wohlfühl (0–10) + Trigger (Hitze, Belastung, Schlaf) + Garmin-SpO2 + Notizen | täglich |
| **POTS Tilt-Test** | Active-Stand-Test, 10 Min Liegen + 10 Min Stehen, Polar H10 | wöchentlich |
| **Statistik** | Verteilungen, Durchschnitte, Trigger-Häufigkeiten | jederzeit |
| **Arzt-Bericht** | Druckbarer Verlauf (30/90/180/365 Tage), PDF via Browser-Druck | bei Bedarf |

## Architektur

```
vital/
├── index.html              ← Multi-Screen-Layout
├── styles.css              ← Nordic Dark Design + Print-Stylesheet
├── core.js                 ← Config, State, Utils, Storage, Bluetooth, Speech, Audio
├── tests.js                ← Test-Module: TiltTest, MorningRoutine, EveningBP, Diary
├── ui.js                   ← Dashboard, Screen-Manager, Report-Generierung
├── icon.svg                ← App-Icon (Herz + EKG)
├── manifest.webmanifest    ← PWA-Manifest
└── README.md               ← diese Datei
```

**Trennung der Belange**: Jedes Modul ist eigenständig, Storage erfolgt in separaten LocalStorage-Tabellen pro Modul (atomare Lese-/Schreibvorgänge). Keine Race-Conditions zwischen den Modulen.

## Storage-Layout

| Key | Inhalt |
|-----|--------|
| `vital.tilt.v1`    | POTS Active-Stand-Tests |
| `vital.morning.v1` | Morgen-Routine (BD liegend + HRV + Orthostat) |
| `vital.evening.v1` | Abend-BD |
| `vital.diary.v1`   | Tagebuch-Einträge |
| `vital.settings.v1`| App-Einstellungen (reserviert) |

Versionierung über `version`-Feld im Payload für spätere Migrationen vorgesehen.

## Voraussetzungen

| Komponente | Details |
|------------|---------|
| **Browser**| Chrome oder Edge (Web Bluetooth nötig). Safari/Firefox: Tilt-Test/HRV ohne Polar-Anbindung; Eingabe-Module funktionieren überall. |
| **HTTPS**  | Web Bluetooth erfordert HTTPS (oder `http://localhost`). Deshalb GitHub Pages. |
| **Hardware** | Polar H10 Brustgurt (für Tilt-Test und HRV-Messung), Blutdruckmessgerät (Werte werden manuell eingegeben) |

## Deployment auf GitHub Pages

1. Neues Repository erstellen (z.B. `vital`)
2. Alle Dateien aus diesem Ordner ins Repo-Root pushen
3. **Settings → Pages → Source: `main` branch / `/ (root)`** wählen
4. Nach ~1 Min ist die App erreichbar unter `https://<user>.github.io/vital/`
5. Auf dem Handy aufrufen und im Browser-Menü **"Zum Startbildschirm hinzufügen"** wählen — danach läuft sie wie eine native App.

## Bedienung

**Erster Start**: Im Dashboard auf eine Kachel tippen — die jeweilige Test-Routine startet. Beim ersten Tilt-Test/HRV wird der Polar H10 via Bluetooth-Dialog gekoppelt.

**Tägliche Routine** (Beispiel-Workflow):

1. Morgens vor dem Aufstehen: **Morgen-Routine** starten
    - BD-Werte vom BD-Gerät eingeben
    - Polar H10 anziehen → "5 Min HRV messen"
    - Optional aufstehen → "Orthostat-Test starten" (BD nach 1/3/5 Min Stehen)
2. Abends vor dem Schlafengehen: **Abend-BD** starten und Werte eingeben
3. Abends: **Tagebuch** öffnen — Schieberegler für Schwindel/Wohlfühl, Trigger-Schalter, Schlafdaten von Garmin
4. **POTS-Test** wöchentlich — Dashboard zeigt Fälligkeit an

**Vor Arzt-Besuch**: Auf **"Arzt-Bericht"** tippen → Zeitraum wählen (z.B. 90 Tage) → **"Drucken / PDF"** — der Browser bietet PDF-Export als Druckziel an.

## Status-Anzeige im Dashboard

Jede Kachel zeigt einen Status-Tag:

| Tag | Bedeutung |
|-----|-----------|
| **OK** (grün)     | Innerhalb des Intervalls erledigt |
| **Heute** (grün)  | Heute bereits erfasst |
| **Fällig** (gelb) | Heute fällig, noch nicht erledigt |
| **Xd über** (rot) | X Tage überfällig |
| **Neu** (gelb)    | Noch nie gemacht |

## Datenschutz

100% lokal — keine Cloud, keine Backend-Server, keine Tracker. Daten verbleiben im Browser-LocalStorage des Geräts. JSON-Export jederzeit möglich (Button auf der Bericht-Seite). Bei Browser-Wechsel oder Geräte-Wechsel: Export → manuell sichern → Import via JSON ist programmatisch vorbereitet (Storage.importAll).

## Sicherheitshinweis

Diese App ist **kein** medizinisches Gerät und ersetzt **keine** ärztliche Diagnose. Sie dient ausschliesslich dem Self-Monitoring und der Datenaufzeichnung für Arzt-Gespräche. Im Notfall: Notruf 144.

## Version

VITAL 2.0 — Mai 2026
