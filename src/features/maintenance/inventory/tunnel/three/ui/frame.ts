// The box the 3D view takes on the page. The loading state and the view itself both use
// it, so nothing jumps when one replaces the other. Short on phones, so the page above
// and below stays within a thumb's reach.
export const FRAME = 'relative h-[min(60svh,460px)] w-full md:h-[clamp(420px,62vh,720px)]'

// The overlays lay themselves out by the width of the view itself, not the window (it
// can be narrow on a wide screen, beside the page's side panel). Their classes spell the
// widths out, because Tailwind has to see whole class names:
//   under 640 px   the card is a sheet along the bottom, the legend folds away
//   under 520 px   a phone: half the toolbar stacks down the left edge, buttons are 44 px
//   640 to 1000 px the page's bar keeps to the left, on the card or beside the legend
//   1000 px and up the page's bar sits in the bottom row between the card and the
//                  legend, centered on the canvas while there is room
