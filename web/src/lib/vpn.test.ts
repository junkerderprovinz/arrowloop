import { describe, expect, it } from 'vitest'

import { vpnChoiceNote } from './vpn'

const tunnel = { id: 'home' }

describe('the note under a job choice of VPN', () => {
  it('says where to set one up while none is, without a warning', () => {
    expect(vpnChoiceNote(true, [], '')).toEqual({ said: 'edit.vpnNone', fails: false })
  })

  it('warns when the VPN the job names is gone', () => {
    expect(vpnChoiceNote(true, [tunnel], 'work')).toEqual({ said: 'edit.vpnGone', fails: true })
    expect(vpnChoiceNote(true, [], 'work')).toEqual({ said: 'edit.vpnGone', fails: true })
  })

  it('warns when the engine has no VPN for the one the job names', () => {
    expect(vpnChoiceNote(false, [], 'home')).toEqual({ said: 'edit.vpnNotHere', fails: true })
  })

  it('stays away while the VPN the job names is there, or the job names none among several', () => {
    expect(vpnChoiceNote(true, [tunnel], 'home')).toBeNull()
    expect(vpnChoiceNote(true, [tunnel], '')).toBeNull()
  })
})
