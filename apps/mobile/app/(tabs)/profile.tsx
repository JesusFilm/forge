import { LibraryDownloads } from "../../src/components/library/LibraryDownloads"
import { AccountSection } from "../../src/components/profile/AccountSection"
import { PrivacyPolicyButton } from "../../src/components/profile/PrivacyPolicyButton"
import { useT } from "../../src/i18n/useT"

// ProfileScreen hides the other external links (socials, Give, About,
// Contact, newsletter, Legal) for now. ProfileLinksSection stays on disk so
// they can return.
export default function ProfileScreen() {
  const t = useT("Profile")
  return (
    <LibraryDownloads
      header={<AccountSection />}
      title={t("myDownloadsTitle")}
      footer={<PrivacyPolicyButton />}
    />
  )
}
