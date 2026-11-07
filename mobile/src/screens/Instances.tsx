import { useT } from "../i18n";
import { OtherInstances } from "../otherInstances";
import { Body, Page, Section } from "../ui";

/** The other instances of the group with their jobs, the page More leads to once it is pinned. */
export function Instances() {
  const { t } = useT();
  return (
    <Page>
      <OtherInstances
        firstHue={0}
        empty={
          <Section title={t("nav.instances")} hue={0}>
            <Body muted>{t("instances.none")}</Body>
          </Section>
        }
      />
    </Page>
  );
}
