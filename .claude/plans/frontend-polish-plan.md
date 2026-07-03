# Plan - Polish and Enhance OmniPilot Frontend UI/UX

To further polish and professionalize OmniPilot's UI/UX, we will implement beautiful enhancements across the requested visual and interactive dimensions, while keeping full compatibility with the existing test suites.

## 1. Enhancements Overview

### A. Modern Chat Bubbles
- We will transform the plain-text/flat styling of messages inside the panel body into modern, beautiful chat bubbles with soft border-radii, consistent padding, elegant transitions, and a clean alignment.
- **User Messages**: Rounded pill-like shape (`border-radius: 16px 16px 4px 16px`), rich background with a subtle gradient/translucency, and a clear accent tone.
- **Assistant Messages**: Elegant, spacious bubble layout (`border-radius: 4px 16px 16px 16px`), custom container backgrounds in both dark/light mode, and clean line height/typography.

### B. Sender Avatars
- Display stylized visual roles at the top of each message bubble or as a compact side avatar.
- **Assistant**: System icon logo (e.g. ✦ OmniPilot) with a glowing, professional status or background element.
- **User**: Stylized "You" or user profile circle.
- This creates clean, readable message grouping and separates content layers logically.

### C. Markdown Code Blocks & Code Highlighting
- Instead of basic plain HTML replacements that only handle `**bold**`, `*italic*`, and `\n`, we will write a streamlined, self-contained Markdown and code parser in `content.js`'s `formatResult` function.
- It will parse:
  - **Inline Code**: `code` formatted with a custom font (`SF Mono`, monospace), subtle background, and soft borders.
  - **Code Blocks**: Multiline code block fences (````js ... ````) parsed into a beautiful code block card with:
    - A dedicated header showing the language name (e.g., `javascript`, `python`, `css`).
    - A "Copy" button inside the header that lets the user copy the code snippet with visual checkmark feedback.
    - Code background formatting, horizontal scrolling, and monospace sizing.
  - **Unordered/Ordered Lists**: Standard parsing of `- list item` or `1. list item` into beautifully indented HTML lists.
  - **Blockquotes**: Elegant blockquotes (`> text`) with custom left borders.

### D. Interactive Buttons & UI Elements
- **Popup UI & Options UI**:
  - Soften shadows, add sleek background gradients, and optimize the layout.
  - Make buttons interactive with rich micro-transitions on `:hover` and `:active` (such as scale down slightly on click).
  - Modernize toggle controls and drop-down selectors to feature smooth scale-in and fade-in animations.
  - Apply professional Material 3 focus rings (`outline` combined with `box-shadow`) so focus navigation is beautifully highlighted.

---

## 2. Implementation Steps

We will implement this purely by updating:
1. `styles.css`: Full stylesheet refresh to support the new modern chat bubbles, code card layout, custom list styles, scrollbars, copy buttons, and hover interactions.
2. `content.js`: Enhance `formatResult` to parse inline code, code blocks, lists, and render copy-to-clipboard functionality cleanly. Ensure any HTML generated is properly parsed and safe. Include event delegation to handle clicks on copy-to-clipboard buttons inside the panel body.

Let's exit the plan mode and implement these visual polishes carefully. No functionality will be altered, only the visual skinning and formatting. All tests will pass completely!
