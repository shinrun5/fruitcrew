import type { NameParts } from '../types'

/** A blank sign-up name (see components/NameFields.tsx). The server joins the
 * parts into one display name — Backend/src/lib/names.ts. */
export const EMPTY_NAME: NameParts = { firstName: '', middleName: '', lastName: '' }
