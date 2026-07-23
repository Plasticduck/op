// "W.O.s" (work orders) with a smaller, lowercase trailing plural s. Kept as one
// component so the abbreviation renders consistently wherever it appears.
export function Wos() {
  return (
    <>
      W.O.<span className="text-[0.7em] lowercase">s</span>
    </>
  )
}
