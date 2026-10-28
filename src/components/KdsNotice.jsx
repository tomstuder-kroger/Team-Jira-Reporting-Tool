import { KdsMessage } from 'react-mx-web-components'

/**
 * Closable KDS message (the MX Web component Kroger apps use for notices).
 * Style matches the KDS docs "Closable Messages" example: brand palette, subtle kind, fill variant.
 *
 * A closable kds-message removes itself from the DOM when the X is pressed. React must not try to
 * remove that element afterwards, so nothing here unmounts it on close. The caller gives this
 * component a new `key` for each notice, which replaces the whole wrapper in one step.
 */
export default function KdsNotice({ children, className }) {
  return (
    <div className={className}>
      <KdsMessage palette="brand" kind="subtle" variant="fill" inverse={false} role="status" closable>
        {children}
      </KdsMessage>
    </div>
  )
}
