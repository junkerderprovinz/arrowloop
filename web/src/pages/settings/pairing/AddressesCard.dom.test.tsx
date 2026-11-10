// @vitest-environment jsdom
// The addresses card takes an address an owner types in, says who answers
// there or why nobody of the group does, and lets an address go again.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../../lib/api'

const addAddress = vi.fn()
const saveAddresses = vi.fn()
vi.mock('../../../lib/api', async (original) => ({
  ...(await original<typeof import('../../../lib/api')>()),
  api: {
    addAddress: (a: string) => addAddress(a),
    saveAddresses: (a: string[]) => saveAddresses(a),
  },
}))

import { en } from '../../../lib/i18n'
import { AddressesCard } from './AddressesCard'

function card(addresses: string[] = []) {
  const onChange = vi.fn()
  render(<AddressesCard addresses={addresses} hueIndex={7} onChange={onChange} />)
  return onChange
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText(en['pairing.addresses.label']), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: en['pairing.addresses.add'] }))
}

describe('AddressesCard', () => {
  beforeEach(() => {
    addAddress.mockReset()
    saveAddresses.mockReset()
  })
  afterEach(cleanup)

  it('names the instance that answers at an address and lists the address', async () => {
    addAddress.mockResolvedValue({ member: { id: 'a', name: 'cellar', state: 'pending' }, addresses: ['http://192.168.1.10:8422'] })
    const onChange = card()
    type('192.168.1.10')
    expect(addAddress).toHaveBeenCalledWith('192.168.1.10')
    await screen.findByText(en['pairing.addresses.found'].replace('{name}', 'cellar'))
    expect(onChange).toHaveBeenCalled()
  })

  it('says in words why nobody of the group answers', async () => {
    addAddress.mockRejectedValue(new ApiError('refused', 400, 'addressStranger', { address: '192.168.1.11' }))
    card()
    type('192.168.1.11')
    await screen.findByText(en['pairing.addresses.errStranger'].replace('{address}', '192.168.1.11'))
  })

  it('lets an address go again', async () => {
    saveAddresses.mockResolvedValue({ addresses: [] })
    const onChange = card(['http://192.168.1.10:8422', 'http://192.168.1.12:8422'])
    expect(screen.getByText('192.168.1.10:8422')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: en['pairing.addresses.remove'] })[0])
    await waitFor(() => expect(saveAddresses).toHaveBeenCalledWith(['http://192.168.1.12:8422']))
    expect(onChange).toHaveBeenCalled()
  })

  it('says so when no address is kept yet', () => {
    card()
    expect(screen.getByText(en['pairing.addresses.empty'])).toBeTruthy()
  })
})
