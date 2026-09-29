import { LibraryDownloads } from "../../src/components/library/LibraryDownloads"
import { AccountSection } from "../../src/components/profile/AccountSection"
import { NotificationTestIdSection } from "../../src/components/profile/NotificationTestIdSection"
import { PrivacyPolicyButton } from "../../src/components/profile/PrivacyPolicyButton"

// ProfileScreen hides the other external links (socials, Give, About,
// Contact, newsletter, Legal) for now. ProfileLinksSection stays on disk so
// they can return.
export default function ProfileScreen() {
  return (
    <LibraryDownloads
      header={
        <>
          <AccountSection />
          <NotificationTestIdSection />
        </>
      }
      title="My Downloads"
      footer={<PrivacyPolicyButton />}
    />
  )
}
