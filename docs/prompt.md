Reimagine the existing Club Athletic website in `apps/web` as an exceptional, fully usable digital guide for the Club Athletic Méribel ski trip. Use the MotionSites Web Builder skill for the design process: inspect the closest examples, write a precise visual and interaction spec before coding, implement it in the existing app, then review screenshots and refine the result. Treat the examples as a quality bar for visual specificity and craft, not as templates to copy.

## What this site is

Club Athletic is a private group trip hub for a week at Falcon Lodge F in Méribel, France, Saturday 30 January through Saturday 6 February 2027. Guests use it to understand the trip, coordinate travel, and find practical information. The site includes an overview with an AI concierge, schedule, flights, Geneva airport shuttle, chalet details, rooms and pricing, guest list, chef meals and dietary preferences, tasks, useful links, FAQ, and a guest details form. This is a shared trip guide, not a resort booking site or a generic travel brand.

## Creative direction

Create the feeling of opening a beautifully art-directed winter trip journal made for a close group of friends: alpine, tactile, warm, confident, and quietly playful. Blend editorial travel photography and typography with the clarity of a well-organized field guide. Make the week in Méribel feel tangible through considered imagery, strong composition, precise type, subtle texture, and a clear sense of place. Use the existing chalet photo and other local assets where they fit; inspect the assets before choosing them.

Build a coherent visual system for the full site, including its navigation, overview, information pages, tables, forms, chat, dialogs, and mobile navigation. Give the overview a memorable first impression and make the rest of the pages feel like chapters in the same guide. Use hierarchy, image crops, whitespace, rules, labels, and a restrained accent palette to make logistics easy to scan. Keep decoration in service of orientation and atmosphere. Avoid generic SaaS dashboards, stock luxury-hotel tropes, repeated rounded-card grids, gratuitous glass effects, and motion that makes the information harder to use.

## Art direction and behavior

- Keep the Club Athletic name and the Méribel ’27 identity. The trip is at Falcon Lodge F, in Méribel in the Three Valleys. Preserve the exact dates and all existing trip facts.
- Use a rich winter palette grounded in the existing brand: snow and warm paper tones, ink-dark typography, evergreen or alpine accents, and one vivid lift-ticket accent. Keep text contrast high and the overall page light enough for long-form logistics.
- Use the existing bundled Hanken Grotesk and Inter fonts where appropriate. Create an expressive editorial heading scale and a highly readable interface scale. Do not add remote font dependencies.
- Use real local photography already in the project. Do not add remote video, invented chalet imagery, or unlicensed stock assets. Favor a few strong, carefully cropped images over decorative image grids.
- Make motion quiet and purposeful: brief page transitions, restrained reveals, and useful interaction feedback. Respect reduced-motion preferences and keep content immediately available.
- Design every route for mobile first and adapt cleanly through tablet to desktop. Make navigation, data tables, forms, buttons, chat controls, and dialogs comfortable to use with touch and keyboard. Prevent horizontal overflow and account for mobile safe areas and the soft keyboard.

## Content and product requirements

- Preserve the current route structure and all existing destinations: `/`, `/schedule`, `/flights`, `/shuttle`, `/chalet`, `/rooms`, `/spots`, `/chef`, `/tasks`, `/links`, `/guests`, `/faq`, and `/guest-details`.
- Keep the current data loading, server rendering, and working behavior. Preserve the AI concierge, conversation history, attachments and flight screenshot flow, guest detail submission, dietary and cocktail updates, links, copy actions, sort controls, and all other existing interactions.
- Use the app’s actual data and copy. Do not invent schedule entries, travel details, prices, room assignments, guest information, amenities, recommendations, or promises. Show unknown or pending information as pending.
- This is an unlisted, unauthenticated link. Assume every visitor can see all rendered information. Do not add authentication or expose credentials, booking references, or data that the app does not currently show.
- Keep the current React Router, React, TypeScript, Tailwind, and Bun stack. Work inside `apps/web`; do not scaffold a separate site or add a root package/workspace.
- Read the repository instructions and existing visual test documentation before changing code. Preserve the desktop screenshot baseline and the established mobile CSS breakpoint convention unless the repository’s current instructions explicitly allow updating them.

## Execution

Inspect the app, its current screenshots, local images, route components, shared shell, and styles. Choose a specific visual concept and state it in a concise implementation spec with page composition, typography, color, image treatment, responsive rules, and interaction details. Then implement the design throughout the app, keeping its real data and functionality intact. Run the applicable existing checks, inspect the changed pages at phone, tablet, and desktop sizes, and iterate on any visual or interaction problems. Finish by reporting the concrete changes and the checks you actually ran.
