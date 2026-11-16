# FoodShare

Project Management endterm prototype, group SE-2404. Instructor Alimova Balaussa.

Team: Ruslan Bolatbekuly (Product Owner), Ayana Markhabat (Scrum Master), Abilmansur Kassymov and Balgyn Yermakhanbet (Developers). These are the accountabilities in the supplied team plan.

FoodShare demonstrates a shared catalogue of surplus food in Astana. Buyers can filter by category, pickup day, price and distance, save favorites, use the map, and reserve or cancel bags. The café can publish offers, manage availability and verify pickup tickets. All cafés are fictional and payments are simulated.

## Run locally

With Node.js 24 or later, run:

```sh
npm run dev
```

On Windows PowerShell, use `npm.cmd run dev` if script execution is restricted. Open http://localhost:4173. The server serves the UI and API from one origin and keeps a separate SQLite database under `.foodshare/`. Both café and buyer workflows are enabled in the local demo. Open a private browser window to test a second buyer session. The map requires internet access. Set `FOODSHARE_PORT` if port 4173 is in use.

## Demonstration

1. In Discover, open a bag and read its allergen information.
2. Confirm the demo disclosure, select two bags and reserve them.
3. Show the QR ticket and copy its `FS-XXXXXXXX` code.
4. Open Café workspace, paste the code and select Verify.
5. Open Our impact. Two Qala Bakery bags produce 1.4 estimated kg, ₸2,400 demo revenue and ₸4,800 demo buyer savings.
6. A second verification of the same code fails. A separate active reservation can be cancelled once, restoring its stock. Pausing an offer hides it from Discover while its existing pickup tickets remain usable.

## Verification

Run `npm test` with Node.js 24 or later. The tests cover domain arithmetic, cancellation, expiry, concurrent reservations for the last bag, ticket privacy, operator permissions, duplicate collection and shared photo uploads.

## Hosted app

`npm run build` bundles the pages and server API as a single Worker for Sites. D1 stores the shared catalogue. The hosted Café workspace uses ChatGPT sign-in. The server checks the verified email against the server-only `CAFE_OWNER_EMAIL` value for the site owner. The owner can grant or revoke access to a named café in **Café team access**. Staff sign in using the approved email and can manage that café only.

Visitors can reserve demo offers as guests. Live offers require buyer sign-in so the ticket follows their account across devices. Publish a live offer only for a participating café that has confirmed the food, price, pickup window and address. The buyer pays directly at pickup. Demo listings stay marked as such and their statistics remain separate. The hosted database starts with demo offers. Earlier browser-only orders are separate.

## Boundaries

The app is a classroom demo. A QR code encodes a pickup token for the café to enter. Early collection is allowed for demonstrations. Distances are illustrative and use a central Astana reference point. Shared pickup times are in Astana time.

## Credits

Illustrative food photographs are downloaded from Unsplash:

- Bread: https://images.unsplash.com/photo-1509440159596-0249088772ff
- Salad: https://images.unsplash.com/photo-1546069901-ba9599a7e63c
- Pastries: https://images.unsplash.com/photo-1517433367423-c7e5b0f35086
- Produce: https://images.unsplash.com/photo-1518843875459-f738682238a6

The kitchen table hero photograph was generated for this redesign.

Unsplash license: https://unsplash.com/license. Images do not depict actual FoodShare partner businesses.

Map data: © OpenStreetMap contributors, https://www.openstreetmap.org/copyright.

QR Code Generator for JavaScript 1.4.4 by Kazuhiko Arase, https://github.com/kazuhikoarase/qrcode-generator. The original copyright and MIT license notice are retained in `dist/assets/qrcode.js`. See THIRD_PARTY_NOTICES.txt for the MIT license text.
