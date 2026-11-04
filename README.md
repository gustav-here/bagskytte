# Bågskytte

En mobilanpassad webbapp (PWA) på svenska för bågskytteträning på iPhone. Appen läggs på hemskärmen, fungerar helt offline och kräver ingen App Store.

- **Räkna serie**: registrera tävlingsomgångar med 1 eller 2 serier à 30 pilar, med protokoll (Poäng, Serie, Totalt).
- **Statistik**: egen statistik för Räkna serie och för Jämför pilar, med heat map och genomsnittsträff.
- **Jämför pilar**: skjut ett set numrerade pilar i varv och jämför statistik per pil.

All data sparas lokalt på telefonen i IndexedDB. Den sparas efter varje pil.

## Filer

| Fil | Innehåll |
| --- | --- |
| `index.html` | Sidan och metataggar för hemskärm, standalone och safe areas |
| `styles.css` | All stil |
| `app.js` | All logik: poäng, måltavla, placering, databas och vyer |
| `manifest.webmanifest` | Webbappens manifest |
| `sw.js` | Service worker för offlinestöd (`CACHE_VERSION`) |
| `icons/` | Ikoner 180, 192 och 512 px |
| `tests.html` | Automatiska test |

Det finns ingen byggprocess och inga beroenden. Alla sökvägar är relativa, så appen fungerar även i en undermapp (t.ex. `https://användare.github.io/bagskytte/`).

## Publicera på GitHub Pages

1. Skapa ett nytt repo på GitHub, t.ex. `bagskytte`.
2. Ladda upp alla filer och mappen `icons/` till repots rot, antingen med **Add file → Upload files** på github.com eller med git:
   ```bash
   git init
   git add .
   git commit -m "Bågskytte"
   git branch -M main
   git remote add origin https://github.com/ANVÄNDARE/bagskytte.git
   git push -u origin main
   ```
3. Gå till **Settings → Pages**. Välj **Deploy from a branch**, branch `main` och mapp `/ (root)`. Spara.
4. Efter någon minut finns appen på `https://ANVÄNDARE.github.io/bagskytte/`. GitHub Pages använder HTTPS, vilket krävs för service worker.

Mappen `.claude/` behövs bara för lokal utveckling och kan lämnas utanför.

### Uppdatera appen

1. Ändra filerna.
2. **Byt `CACHE_VERSION` i `sw.js`** (t.ex. `bagskytte-v1` → `bagskytte-v2`). Annars fortsätter installerade appar att använda den gamla cachen.
3. Ladda upp och vänta tills GitHub Pages har publicerat.
4. På iPhone: öppna appen, stäng den helt och öppna den igen. Den nya versionen hämtas i bakgrunden vid första starten och används från nästa start.

## Installera på iPhone

1. Öppna adressen i **Safari** (inte i en app-intern webbläsare).
2. Tryck på **Dela** (fyrkanten med pil uppåt).
3. Välj **Lägg till på hemskärmen** och tryck **Lägg till**.
4. Starta appen från ikonen på hemskärmen. Den öppnas i helskärm utan Safaris adressfält.
5. Öppna appen en gång med nätanslutning. Därefter fungerar den helt offline.

Datan ligger lokalt i den installerade appen och är separat från Safari. Om appen tas bort från hemskärmen försvinner datan, så **exportera en backup regelbundet**.

## Backup

- **Exportera backup** på startsidan skapar en JSON-fil. På iPhone öppnas delningsmenyn, där du kan välja **Spara i Filer**. Om delning inte stöds laddas filen ned i stället.
- **Importera backup** läser in en sådan fil. Importen **ersätter** all data i appen efter bekräftelse. Den slås inte ihop med befintlig data.

## Test

Öppna `tests.html` i en webbläsare via en webbserver (t.ex. `python3 -m http.server` i mappen och sedan `http://localhost:8000/tests.html`). Testerna använder en egen databas (`bagskytte-test`) och påverkar inte appens data.

Testerna täcker:

- Poängfunktionen: d = 0 → X, 1,5 → X, 1,51 → 10, 3 → 10, 3,01 → 9, 6 → 9, 18 → 5, 24 → 3, 30 → 1, 30,01 → miss. Dessutom alla zongränser, flyttalsfel på gränser och låsning vid ytans kant.
- Kolumnerna Poäng (radens summa), Serie och Totalt i serie 1 och 2, även påbörjade rader. Antalet 10:or inkluderar X.
- Flödet efter pil 30: automatisk sparning, Nästa (serie 2 med serie 1 i Totalt), Avsluta, granskningsläget efter serie 2 (även efter omladdning) och Spara mitt i en serie.
- Ångra: mitt i en rad, ”Ångra sista pilen” i dialogen, i tom serie 2, efter serie 2 och i jämförelser.
- Återupptagning efter omladdning: databasen stängs och läses in på nytt för pågående omgång, öppen serie 2-dialog och pågående jämförelse.
- Set: stigande skjutordning, nytt varv på lägsta numret, validering och delade pilnummer.
- Borttagning av pil: borttagning ur set, radering av tomma set, att jämförelser behåller sina skott och att samma nummer blir en ny pil.
- Statistik per jämförelse och per pil över flera jämförelser, avslut mitt i varv och att tomma jämförelser inte sparas.
- Export och import fram och tillbaka, ersättning av data och avvisning av felaktiga filer.
- Statistiköversikten (snitt per omgång, snitt per pil, totaler) och diagrammets skalsteg.
- Genomsnittsträff, heat map (täthet, symmetri, färgskala), grå tavla och sammanställning per pil över alla jämförelser (även borttagna pilar).
- Tavlans zoner, linjer och kors samt zoomkonstanterna (4×).

## Val och tolkningar

Där specifikationen var oklar har jag gjort följande val:

- **Koordinater**: cm med centrum i (0, 0). y växer **nedåt**, som i SVG. Koordinaterna avrundas till 0,01 mm och poängen räknas på det avrundade värdet.
- **Tidsstämplar** (`createdAt`) sparas som millisekunder sedan 1970. Standardnamnet är ”Omgång ÅÅÅÅ-MM-DD”.
- **När omgången sparas**: posten i `rounds` skapas när serie 1 är fullskjuten och innehåller bara fulla serier. Under serie 2 visas omgången därför med serie 1 i listan. Om pågående serie 2 slängs finns omgången kvar med en serie.
- **Tillbaka och Spara**: uppe till vänster under en pågående omgång finns **‹** (tillbaka) och **Spara**. Båda tar dig till startsidan, och Spara bekräftar dessutom att omgången är sparad. Allt är redan sparat efter varje pil, och omgången återupptas med ”Fortsätt pågående”.
- **Efter pil 30** (både serie 1 och serie 2) visas ingen dialog direkt. Tavlan visar alla pilar i serien. Dialogen öppnas när du trycker på siffrorna (tabellen) eller på knappen **Gå vidare** under tavlan, bredvid väljaren Serie 1 / Serie 2 / Båda. Dialogen kan stängas med X och öppnas igen på samma sätt.
- **Dialogen efter serie 1**: **Avsluta** går till huvudmenyn (omgången är sparad med en serie), **Nästa** startar serie 2.
- **Dialogen efter serie 2**: **Avsluta** går till huvudmenyn, **Visa omgång** öppnar den sparade omgången. Efter serie 2 kan du växla mellan Serie 1, Serie 2 och Båda, både i skjutvyn och i den sparade omgången.
- **Ångra sista pilen** finns kvar som länk i båda dialogerna. Ångra efter pil 30 tar bort pil 30. Är det serie 1 tas den sparade posten bort tills serien är full igen. Är det serie 2 sparas omgången med bara serie 1 tills serie 2 är full igen.
- **Markeringar på tavlan** under skjutning: pilarna i aktuell rad (eller aktuellt varv) ligger kvar efter sista pilen. De tas bort först när fingret sätts ned för nästa rads första pil, så att man hinner jämföra med tavlan.
- **Markeringarnas nummer**: i Räkna serie är numret pilens plats i raden (1–3). När en serie är klar och i sparade omgångar visas träffarna som prickar utan nummer (grön = serie 1, rosa = serie 2), eftersom 60 numrerade markeringar blir oläsliga.
- **Markera en pil i sparad omgång**: tryck på en poängsiffra i tabellen. Pilen visas orange med dubbel ring och sitt nummer i serien (1–30), övriga träffar tonas ned, och under tavlan står serie, rad och pil. Tryck igen för att avmarkera. Tavlan ligger kvar överst när du scrollar i tabellerna.
- **Siffror på tavlan** i Räkna serie: tavlan fyller hela bredden. Nere till vänster i ramytan visas poängen live under placering och därefter senaste pilens poäng, i en liten ruta färgad efter zonen. Nere till höger visas seriens summa, och i serie 2 totalen för båda serierna med serie 2:s summa ovanför (”S2”). Protokollets radhöjd anpassas efter skärmen så att tavlan blir så stor som möjligt utan scroll.
- **Live-siffran** i Jämför pilar visas i högerkolumnen bredvid tavlan och färgas efter zonen.
- **Två statistikknappar** på startsidan: en under Räkna serie och en under Jämför pilar. Knappen Statistik på sidan Jämför pilar öppnar samma vy som den senare.
- **Statistik för Räkna serie**:
  - *Snitt/omgång* = medelvärdet av omgångarnas totalpoäng.
  - *Snitt/pil* = all poäng delat med alla pilar.
  - *Totalt* = summan av all poäng.
  - Dessutom *Bästa* omgång och antal 10:or/X.
  - Diagrammet visar varje omgångs poäng i tidsordning. Det kan växlas till snitt per pil, vilket är bättre när omgångar med 1 och 2 serier blandas. Tryck i diagrammet för att se en omgång. Under diagrammet listas alla omgångar.
- **Avsluta** i Jämför pilar och **Släng pågående** kräver bekräftelse, så att ett feltryck inte avslutar eller slänger.
- **Ny omgång eller jämförelse när en annan pågår**: appen frågar om den pågående ska slängas. Det finns bara en pågående session åt gången.
- **Pilnummer** är heltal 1–999.
- **Statistik för Jämför pilar** visar all sparad statistik på en gång:
  - totaler för alla jämförelser
  - en tavla med alla skott, där varje pil har sin färg och sitt nummer
  - ett kort per pil med alla poäng, antal skott, snitt, 10:or och X.

  Tryck på ett kort (eller en filterknapp) så visar tavlan bara den pilens träffar. Tryck på kortet igen för att visa alla. Samma sak fungerar i en sparad jämförelse.
- **Borttagna pilar** finns kvar i databasen med `deleted: true`, så att sparade jämförelser kan visa deras nummer. De visas inte i pilregistret. I statistiken för Jämför pilar visas de som ”Pil 2 (borttagen)”, eftersom de har sparade skott.
- **Heat map och genomsnittsträff** finns
  - för en sparad omgång (vald serie eller båda)
  - för alla tävlingsomgångar sammanräknat (Statistik för Räkna serie, visas som heat map från början)
  - för en sparad jämförelse
  - för alla jämförelser sammanräknat.

  Ovanför tavlan växlar du mellan **Träffar** och **Heat map**. Den visar alla träffar eller den valda pilen. Om du markerar en pil via tabellen i en sparad omgång växlar tavlan till Träffar.
  - **Heat map**: tätheten räknas med en Gauss-kärna (σ = 1,5 cm) och visas från genomskinligt gult till mörkrött ovanpå en grå tavla, så att färgerna syns.
  - **Genomsnittsträffen** är medelpunkten av alla träffar som visas, även missar (de ligger kvar där de sattes). Den markeras med ett hårkors med ring och cyan mittpunkt. Under tavlan står hur långt den ligger från mitten i sidled och höjdled, och vilken poäng den motsvarar, t.ex. ”2,4 cm höger, 1,5 cm upp – 10”.
- **Radera jämförelse**: specifikationen nämner det inte, men det finns en knapp med bekräftelse i den sparade jämförelsen.
- **Namnbyte** kan göras både i den sparade omgången och under skjutning (tryck på namnet i toppfältet).
- **Mittkorset** ritas svart.
- **Statusfältet** använder `black-translucent` med mörkt toppfält, så att innehållet går under statusfältet och safe-area-insets styr marginalerna.
- **Stående format**: iOS låser inte alltid orienteringen för hemskärmsappar. I liggande läge på telefon visas därför en uppmaning att vrida telefonen.
- **Datamodell**: `activeSession` sparas i en egen tabell (`meta`). En pågående omgång har `kind: 'round'`, `roundId`, `name`, `createdAt`, `series` och `phase` (`shooting` eller `askSeries2`). En pågående jämförelse har `kind: 'comparison'`, `comparisonId`, `createdAt`, `setId`, `arrows` ([{ id, number }] sorterade på nummer) och `shots`.

## Prova på en riktig iPhone

Följande kan inte testas automatiskt eller i en datorwebbläsare och behöver provas på en riktig iPhone:

- Att installationen fungerar, att ikonen visas och att appen startar i standalone-läge.
- Safe areas: toppfältet under statusfältet/Dynamic Island och knappen Avsluta ovanför home-indikatorn.
- Att layouten i Räkna serie får plats utan scroll på den egna modellen (kontrollerad i 375 × 667 i webbläsare).
- Placering med finger: zoomfönstrets hörnbyte och hysteres, att X:et syns på alla färger, att ett andra finger ignoreras och att inget sparas när iOS avbryter beröringen (t.ex. vid ett inkommande samtal).
- Att ingen zoom, dubbeltryckszoom, textmarkering, förstoringsglas eller kontextmeny dyker upp på tavlan, och att kantsvep inte lämnar vyn.
- Offline: flygplansläge efter första starten.
- Att tryck på tabellen efter pil 30 öppnar dialogen, och att tavlan i en sparad omgång ligger kvar överst när du scrollar (sticky i Safari).
- Att datan finns kvar efter att appen tvångsstängts mitt i en serie, och efter omstart av telefonen.
- Att `navigator.storage.persist()` beviljas. iOS kan rensa data för webbappar som inte använts på länge, så backup rekommenderas.
- Export via delningsmenyn (Spara i Filer) och import från Filer.
- Läsbarheten utomhus i solljus.
