# FoodShare

Project Management endterm prototype, group SE-2404. Instructor Alimova Balaussa.

Team: Ruslan Bolatbekuly (Product Owner), Ayana Markhabat (Scrum Master), Abilmansur Kassymov and Balgyn Yermakhanbet (Developers). These are the accountabilities in the supplied team plan.

The app demonstrates surplus offer publishing, discovery, combined category/price/estimated-distance filters, an OpenStreetMap preview, reservations, QR tickets, cancellation, manual pickup verification and collection-based totals. All cafés are fictional. Payments are simulated.

## Run locally

Use any static HTTP server to serve the `dist` directory. With Python 3:

```sh
python3 -m http.server 4173 --directory dist
```

Open http://localhost:4173. Use HTTP rather than opening index.html directly because the JavaScript uses modules. Normal browser storage must be available. All app assets except the optional map are bundled locally. The map requires an internet connection.

## Demonstration

1. In Discover, open a bag and read its allergen information.
2. Confirm the demo disclosure, select two bags and reserve them.
3. Show the QR ticket and copy its `FS-XXXXXXXX` code.
4. Open Café workspace, paste the code and select Verify.
5. Open Our impact. Two Qala Bakery bags produce 1.4 estimated kg, ₸2,400 demo revenue and ₸4,800 demo buyer savings.
6. A second verification of the same code fails. A separate active reservation can be cancelled once, restoring its stock.

To restart, use About this prototype, Reset demo data, then confirm the reset. Reset affects only this browser.

## Verification

Run `npm test` with Node.js 18 or later. There are ten domain tests covering inventory, invalid quantities, expiry, cancellation, duplicate verification and impact arithmetic. Browser verification also covers the full journey, publishing, validation, filters, persistence, QR generation and mobile overflow at 390 pixels. The task-local browser check and its evidence live under `endterm/.build`; they are not production dependencies.

## Boundaries

The app uses one versioned localStorage record. It has no shared server database, authentication, actual café authorization, real payment provider, live geolocation, camera scanner or push service. A QR code encodes a demo pickup token. The café workspace accepts that token manually or from an external reader. Early collection is allowed to support classroom demonstration. Estimated distances are illustrative and use a central Astana reference point. Example offers are seeded for the next calendar day in the device's local time.

Production needs authenticated roles, server-side validation, atomic reservations, idempotent collection, payment reconciliation and partner operating procedures. Browser storage is editable and is not a security boundary. The production demonstration is public at https://foodshare-se2404.vercel.app. For defense, use this production address or the local copy. Unique Vercel deployment and preview URLs may require sign-in.

## Credits

Illustrative food photographs are downloaded from Unsplash:

- Bread: https://images.unsplash.com/photo-1509440159596-0249088772ff
- Salad: https://images.unsplash.com/photo-1546069901-ba9599a7e63c
- Pastries: https://images.unsplash.com/photo-1517433367423-c7e5b0f35086
- Produce: https://images.unsplash.com/photo-1518843875459-f738682238a6

Unsplash license: https://unsplash.com/license. Images do not depict actual FoodShare partner businesses.

Map data: © OpenStreetMap contributors, https://www.openstreetmap.org/copyright.

QR Code Generator for JavaScript 1.4.4 by Kazuhiko Arase, https://github.com/kazuhikoarase/qrcode-generator. The original copyright and MIT license notice are retained in `dist/assets/qrcode.js`. See THIRD_PARTY_NOTICES.txt for the MIT license text.
