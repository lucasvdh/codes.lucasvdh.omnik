# Apparaat toevoegen

Het koppelen gaat in de meeste gevallen volledig automatisch. Homey zoekt je netwerk af naar Omnik WiFi-modules; staat de jouwe er niet tussen, dan heb je alleen het IP-adres van de WiFi-module nodig.

## Stap 1 - IP-adres opzoeken (alleen als je omvormer niet in de lijst staat)

De WiFi-module verbindt met je thuisnetwerk net als elk ander apparaat. Vind het IP via:

- De DHCP- / "verbonden apparaten"-pagina van je router
- De Omnik-app op je telefoon (als je die ooit hebt ingesteld)
- Een netwerk-scanner zoals Fing

Tip: een vast IP in je router is niet meer nodig. Als het IP verandert, vindt Homey de module terug op zijn MAC-adres en schakelt de app over naar het nieuwe adres. Een vast IP helpt nog wel als dat op jouw netwerk niet werkt.

## Stap 2 - koppelen via Homey

In de Homey-app: *+ Apparaat toevoegen* → *Omnik* → *Omnik-omvormer*.

Tik op de omvormer in de lijst met gevonden apparaten, of vul het IP in en tik op *Volgende*. In de lijst kunnen ook andere apparaten met dezelfde WiFi-chip staan; de app controleert of het een Omnik is voordat hij wordt toegevoegd. De app:

1. Leest `/js/status.js` van de omvormer en haalt automatisch het serienummer van de WiFi-module op
2. Probeert het binaire TCP/8899-protocol met dat serienummer (voorkeur - geeft meer data)
3. Valt terug op HTTP als TCP niet reageert
4. Toont je de live waardes op een bevestigingsscherm zodat je kunt verifiëren voordat je toevoegt

## Als de webinterface een wachtwoord vraagt

De fabrieksdefault is `admin` / `admin` - beide velden zijn voor-ingevuld, je hoeft alleen op *Doorgaan* te tikken. Werkt dat niet, dan zijn de gegevens ooit gewijzigd (zeldzaam); je hebt de aangepaste waarden nodig, of je kunt de WiFi-module resetten om de defaults te herstellen.

## Als auto-detect je omvormer niet vindt

Sommige oudere firmwares hebben geen `/js/status.js` (je krijgt dan een 404). De app biedt dan een *handmatige S/N-invoer*-scherm:

1. Zoek de sticker met het 10-cijferige serienummer. Bij de meeste modellen zit die op de WiFi-stick die op de omvormer is gestoken - maar de TL2-serie en sommige andere modellen hebben de WiFi-module **ingebouwd**, dan zit de sticker op de omvormer zelf.
2. Het nummer begint meestal met `160`, `161`, `604` of `646`.
3. De app slaat HTTP over en probeert TCP direct met dat serienummer.

## Na het koppelen

Het apparaat verschijnt in Homey met alle capabilities. De eerste meting komt binnen seconden binnen; daarna polleert de app standaard elke 5 minuten. Het interval is aanpasbaar via *Apparaat-instellingen → Controle-interval*.
