import { useState } from "react"
import { StyleSheet, View } from "react-native"

import { SecondaryPill } from "../watch/DetailsActionRow"
import { LinkModal } from "../LinkModal"
import { scale } from "../../lib/scale"
import type { NormalizedBlock } from "../../lib/normalizer"
import { isAllowedQuizUrl } from "../../lib/validateUrl"

// ── QuizButtonRenderer ─────────────────────────────────────────────────────

export function QuizButtonRenderer({ section }: { section: NormalizedBlock }) {
  const [modalVisible, setModalVisible] = useState(false)

  const buttonText = section.buttonText as string | null
  const iframeSrc = section.iframeSrc as string | null

  // Silent drop if URL is invalid or missing
  if (!iframeSrc || !isAllowedQuizUrl(iframeSrc)) return null

  const openModal = () => setModalVisible(true)
  const closeModal = () => setModalVisible(false)

  return (
    <>
      <View style={styles.sectionOuter}>
        <SecondaryPill
          icon="help-circle-outline"
          label={buttonText ?? "Take the quiz"}
          onPress={openModal}
        />
      </View>

      <LinkModal
        url={iframeSrc}
        visible={modalVisible}
        onClose={closeModal}
        urlValidator={isAllowedQuizUrl}
        errorText="Couldn't load the quiz."
      />
    </>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sectionOuter: {
    paddingHorizontal: scale(80),
    paddingVertical: scale(12),
    alignItems: "flex-start",
  },
})
