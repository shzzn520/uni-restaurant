# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Inferred from the existing customer and merchant flows: diners use a phone to browse a restaurant menu, place a pickup or delivery order, and check its status. Restaurant staff use a separate merchant area to manage orders, menu items, promotions, and customer feedback.

## Product Purpose

An educational restaurant ordering system built with uni-app and Spring Boot. It demonstrates the customer ordering journey and the corresponding merchant workflow across H5 and WeChat mini-program targets.

## Positioning

The project keeps a local mock data path and a Spring Boot API path behind the same frontend call interface, allowing the same ordering experience to be demonstrated with or without the backend.

## Operating Context

Diners enter through a restaurant QR code or choose a nearby store, browse dishes, select pickup or delivery, and follow order progress. Staff use the merchant pages to process orders and maintain restaurant data.

## Capabilities and Constraints

- Existing functionality includes store selection, dish browsing, cart and checkout, saved delivery addresses, coupons, member balances and points, simulated payment, delivery order statuses, and periodic order refresh.
- The backend and local mock implementation are expected to keep matching behavior.
- Payment is simulated; there is no production payment gateway.
- Delivery progress is based on order statuses maintained by the demo system. Real courier dispatch, courier identity, GPS tracking, and map routing are not integrated.
- The frontend targets H5 and WeChat mini-program using uni-app and Vue 2.
- Product-specific facts in this record are inferred from the repository and the user's request; confirm them before treating them as external product claims.

## Brand Commitments

The user requested a green-and-blue UI palette. No official logo or additional brand identity was identified in the project.

## Evidence on Hand

- Frontend workflows and demo content: `README.md`, `pages/`, and `common/mock.js`.
- Backend API and simulated delivery status behavior: the separately located `restaurant-server` project.
- No production payment, courier tracking, or customer testimonial evidence is present in this workspace.

## Product Principles

- Keep pickup and delivery choices explicit.
- Make prices and delivery estimates traceable to server-calculated order data.
- Keep demo behavior clearly distinguished from production integrations.
- Preserve compatible behavior between mock and backend data paths.
