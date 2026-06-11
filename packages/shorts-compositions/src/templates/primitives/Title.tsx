import { SHORT_FONT_FAMILIES } from "../../fonts"
import { SHORT_SAFE_AREA } from "../../schema"

type TitleProps = {
  text: string
}

// Operator-supplied title renders ONLY as a React text child — never
// dangerouslySetInnerHTML, never interpolated into styles (plan P3-2).
export const Title = ({ text }: TitleProps) => (
  <div
    style={{
      position: "absolute",
      top: SHORT_SAFE_AREA.top,
      left: SHORT_SAFE_AREA.side,
      right: SHORT_SAFE_AREA.side,
      textAlign: "center",
      fontFamily: SHORT_FONT_FAMILIES.montserrat,
      fontWeight: 900,
      fontSize: 56,
      lineHeight: 1.2,
      color: "#ffffff",
      textShadow: "0 2px 12px rgba(0,0,0,0.8)",
    }}
  >
    {text}
  </div>
)
