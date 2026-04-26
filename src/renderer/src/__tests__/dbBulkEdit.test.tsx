// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DbBulkEditDialog } from '../components/features/metrics/DbBulkEditDialog'

afterEach(() => cleanup())

const baseProps = {
  open: true,
  dbNames: ['Alpha', 'Beta', 'Gamma'],
  onClose: vi.fn(),
  onSave: vi.fn(),
  aliasSuggestions: ['Alias1', 'Alias2'],
  ownerSuggestions: ['Andrea C.', 'Mario R.'],
  saving: false
}

describe('DbBulkEditDialog', () => {
  it('renders title with db count', () => {
    render(<DbBulkEditDialog {...baseProps} />)
    expect(screen.getByText(/Edit 3 databases/i)).toBeTruthy()
  })

  it('truncates subtitle when more than 5 db names', () => {
    render(<DbBulkEditDialog {...baseProps} dbNames={['A', 'B', 'C', 'D', 'E', 'F', 'G']} />)
    expect(screen.getByText(/\+2 more/i)).toBeTruthy()
  })

  it('calls onSave with undefined values after two-step confirm when both fields empty', () => {
    render(<DbBulkEditDialog {...baseProps} />)
    fireEvent.click(screen.getByTestId('apply-btn')) // first click → confirm state
    fireEvent.click(screen.getByTestId('apply-btn')) // second click → fires onSave
    expect(baseProps.onSave).toHaveBeenCalledWith({ alias: undefined, referente: undefined })
  })

  it('calls onSave immediately with trimmed value when alias is filled', () => {
    render(<DbBulkEditDialog {...baseProps} />)
    fireEvent.change(screen.getByTestId('alias-input'), { target: { value: 'MyAlias' } })
    fireEvent.click(screen.getByTestId('apply-btn'))
    expect(baseProps.onSave).toHaveBeenCalledWith({ alias: 'MyAlias', referente: undefined })
  })

  it('disables Apply button when saving=true', () => {
    render(<DbBulkEditDialog {...baseProps} saving={true} />)
    expect((screen.getByTestId('apply-btn') as HTMLButtonElement).disabled).toBe(true)
  })

  it('resets confirm state when alias field is edited after both-empty click', () => {
    render(<DbBulkEditDialog {...baseProps} />)
    fireEvent.click(screen.getByTestId('apply-btn'))
    expect(screen.getByTestId('apply-btn').textContent).toMatch(/Confirm/i)
    fireEvent.change(screen.getByTestId('alias-input'), { target: { value: 'x' } })
    expect(screen.getByTestId('apply-btn').textContent).toMatch(/Apply to 3/i)
  })
})
