# Instacart Building

Manifest-only community building for turning grocery requests into user-reviewed Instacart shopping handoffs.

## Current API Fit

The official Instacart docs now describe two different integration families:

- **Instacart Developer Platform** is the right default for agents. It supports recipe pages, shopping-list pages, nearby retailers, and an official MCP server. The resulting Marketplace URL lets the user pick a store, add items to cart, and check out on Instacart.
- **Instacart Connect Fulfillment** is for retailer partners adding Instacart scheduling, full-service shopping, delivery, pickup, and order tracking to their own branded e-commerce site. It can create delivery orders, but only in that retailer-partner context after the required user, cart, time-slot, address, store, payment, and catalog pieces exist.

So this building does **not** claim a general "agent places a consumer Instacart order" capability. It gives agents the safe path: create a shopping list or recipe link, hand it to the user, and require human review before checkout.

## Agent Behavior

- Prefer the official MCP server when the host supports MCP:
  - development: `https://mcp.dev.instacart.tools/mcp`
  - production: `https://mcp.instacart.com/mcp`
- Authenticate with `Authorization: Bearer $INSTACART_API_KEY`.
- Expected MCP tools from the docs: `create-recipe` and `create-shopping-list`.
- For direct REST calls, start with `POST /idp/v1/products/products_link`.
- Use `line_item_measurements` instead of the deprecated top-level `quantity` and `unit` fields for shopping-list items.
- Never print or store API keys.
- Never silently place an order, finalize payment, choose substitutions, buy age-restricted products, set a tip, or reserve a delivery window. Ask the human to review and confirm in the active conversation.

## Minimal REST Payload

Save a payload like this as `instacart-shopping-list.json` when using the direct REST command from the generated guide:

```json
{
  "title": "Grocery handoff",
  "link_type": "shopping_list",
  "line_items": [
    {
      "name": "bananas",
      "display_text": "Bananas",
      "line_item_measurements": [
        {
          "quantity": 6,
          "unit": "each"
        }
      ]
    },
    {
      "name": "whole milk",
      "display_text": "Whole milk",
      "line_item_measurements": [
        {
          "quantity": 1,
          "unit": "gallon"
        }
      ]
    }
  ]
}
```

## Sources

- Instacart Developer Platform introduction: https://docs.instacart.com/developer_platform_api/
- MCP tutorial: https://docs.instacart.com/developer_platform_api/guide/tutorials/mcp/
- Create shopping list page: https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page/
- Shopping list concept: https://docs.instacart.com/developer_platform_api/guide/concepts/shopping_list/
- Nearby retailers: https://docs.instacart.com/developer_platform_api/api/retailers/get_nearby_retailers/
- Instacart Connect overview: https://docs.instacart.com/connect/
- Connect Fulfillment guide: https://docs.instacart.com/connect/fulfillment/
