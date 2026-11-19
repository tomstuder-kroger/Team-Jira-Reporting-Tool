// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import RosterPage from './RosterPage.jsx'

// Made-up names only. The page reads the roster from /api/roster when it loads.
const NAMES = ['Doe, Jamie', 'Roe, Alex (NonEmp)', 'Poe, Sam']
const stubFetch = () => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, roster: NAMES.map((jiraName) => ({ jiraName })) }) }))
}
afterEach(() => { cleanup(); delete global.fetch })

describe('RosterPage', () => {
  it('puts the add-a-team-member search above the tracked list', async () => {
    stubFetch()
    render(<RosterPage />)
    const search = await screen.findByRole('searchbox', { name: /name/i })
    const list = await screen.findByRole('list', { name: 'Tracked Team Members' })
    // DOCUMENT_POSITION_FOLLOWING (4) means the list comes after the search in the page.
    expect(search.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('still lists every tracked person and keeps both headings', async () => {
    stubFetch()
    render(<RosterPage />)
    await waitFor(() => expect(screen.getByText('Tracked Team Members (3)')).toBeTruthy())
    expect(screen.getByText('Add a team member')).toBeTruthy()
    for (const n of NAMES) expect(screen.getAllByText(n).length).toBeGreaterThan(0)
  })
})
