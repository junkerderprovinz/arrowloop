// @vitest-environment jsdom
// The coffee and PayPal windows. What matters is that nothing from either
// provider loads before somebody asks for it, and that the amount and the
// interval PayPal receives are the ones on screen.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Rendered {
  options: Record<string, any>
  close: ReturnType<typeof vi.fn>
}

let rendered: Rendered[] = []
let scripts: HTMLScriptElement[] = []

// PayPal's SDK as far as the window uses it: Buttons draws two buttons into
// the box it is given.
function fakeSdk() {
  return {
    Buttons(options: Record<string, any>) {
      const close = vi.fn(async () => {})
      rendered.push({ options, close })
      return {
        render: async (box: HTMLElement) => {
          box.replaceChildren(document.createElement('iframe'), document.createElement('iframe'))
        },
        close,
      }
    },
  }
}

async function loadScript(script: HTMLScriptElement) {
  ;(window as unknown as Record<string, unknown>)[script.dataset.namespace!] = fakeSdk()
  await act(async () => {
    script.onload!(new Event('load'))
  })
}

async function click(name: string | RegExp, role = 'button') {
  await act(async () => {
    fireEvent.click(screen.getByRole(role, { name }))
  })
}

function amountTabs() {
  return ['10 €', '25 €', '50 €'].map((name) => screen.getByRole('tab', { name }))
}

function otherAmount(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Other amount' }) as HTMLInputElement
}

async function type(value: string) {
  await act(async () => {
    fireEvent.change(otherAmount(), { target: { value } })
  })
}

async function mount() {
  // paypal.ts keeps its loads for the page's lifetime, so each test gets a
  // fresh copy of it.
  vi.resetModules()
  const { About } = await import('./About')
  render(<About version="1.0.0" hueIndex={0} />)
}

async function openPaypal() {
  await mount()
  await click(/^PayPal$/)
}

beforeEach(() => {
  rendered = []
  scripts = []
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const el = create(tag, options)
    if (tag === 'script') scripts.push(el as HTMLScriptElement)
    return el
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  for (const s of document.head.querySelectorAll('script')) s.remove()
  delete (window as unknown as { runtime?: unknown }).runtime
})

// The part of the Wails runtime the card uses, as the desktop build injects it.
function desktop(platform: string) {
  const runtime = {
    BrowserOpenURL: vi.fn(),
    Environment: vi.fn(async () => ({ buildType: 'production', platform, arch: 'amd64' })),
  }
  ;(window as unknown as { runtime?: typeof runtime }).runtime = runtime
  return runtime
}

describe('the PayPal button in the desktop build', () => {
  it.each(['darwin', 'linux'])('opens the donation page in the system browser on %s', async (platform) => {
    const runtime = desktop(platform)
    await openPaypal()
    expect(runtime.BrowserOpenURL).toHaveBeenCalledWith('https://www.paypal.com/donate/?hosted_button_id=76FVV52TKXTUS')
    expect(scripts).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the PayPal window on Windows, where its popup works', async () => {
    const runtime = desktop('windows')
    await openPaypal()
    expect(runtime.BrowserOpenURL).not.toHaveBeenCalled()
    expect(scripts).toHaveLength(1)
  })
})

describe('the links on the card', () => {
  it('reach GitHub and the mail program through the system in the desktop build', async () => {
    const runtime = desktop('linux')
    const open = vi.spyOn(window, 'open')
    await mount()
    await click('GitHub')
    await click('Email')
    await click('1.0.0', 'link')
    expect(runtime.BrowserOpenURL.mock.calls.map((c) => c[0])).toEqual([
      'https://github.com/junkerderprovinz/arrowloop',
      'mailto:hello@halleluja.design?subject=ArrowLoop%20Feedback',
      'https://github.com/junkerderprovinz/arrowloop/releases/tag/v1.0.0',
    ])
    expect(open).not.toHaveBeenCalled()
  })

  it('open a new tab in a browser', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await mount()
    await click('GitHub')
    expect(open).toHaveBeenCalledWith('https://github.com/junkerderprovinz/arrowloop', '_blank', 'noopener,noreferrer')
  })
})

describe('the coffee window', () => {
  it('loads nothing from BMAC or PayPal until a window opens', async () => {
    await mount()
    expect(document.querySelector('iframe')).toBeNull()
    expect(scripts).toEqual([])

    await click('Buy me a coffee')
    const frame = document.querySelector('iframe')!
    expect(frame.src).toBe('https://buymeacoffee.com/widget/page/junkerderprovinz?description=&color=%23FFDD00')
    expect(frame.getAttribute('allow')).toBe('payment')
    expect(screen.getByText('The payment runs through Buy Me a Coffee. You do not need an account.')).toBeTruthy()
    expect(scripts).toEqual([])
  })

  it('closes on Escape', async () => {
    await mount()
    await click('Buy me a coffee')
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(document.querySelector('iframe')).toBeNull()
  })
})

describe('the PayPal window', () => {
  it('loads the one-off SDK only once the window opens', async () => {
    await openPaypal()
    expect(scripts).toHaveLength(1)
    const src = new URL(scripts[0]!.src)
    expect(src.origin + src.pathname).toBe('https://www.paypal.com/sdk/js')
    expect(src.searchParams.get('intent')).toBe('capture')
    expect(src.searchParams.get('currency')).toBe('EUR')
    expect(src.searchParams.has('vault')).toBe(false)
    expect(src.searchParams.get('disable-funding')).toContain('paylater')

    await loadScript(scripts[0]!)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]!.options.style).toMatchObject({ color: 'blue', label: 'donate', height: 40 })
  })

  it('takes the selection away from the presets while a valid amount is typed', async () => {
    await openPaypal()
    expect(amountTabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])

    await type('12,5')
    expect(amountTabs().every((t) => t.getAttribute('aria-selected') === 'false')).toBe(true)
    expect(otherAmount().className).toContain('border-accent')

    await type('')
    expect(amountTabs().map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(otherAmount().className).not.toContain('border-accent')
  })

  it('refuses an amount below one or with three decimals', async () => {
    await openPaypal()
    for (const bad of ['0,50', '3.141', 'ten']) {
      await type(bad)
      expect(otherAmount().getAttribute('aria-invalid'), bad).toBe('true')
    }
    await loadScript(scripts[0]!)
    const reject = vi.fn()
    rendered[0]!.options.onClick(null, { resolve: vi.fn(), reject })
    expect(reject).toHaveBeenCalled()
  })

  it('creates a one-off order with a DONATION item for the amount on screen', async () => {
    await openPaypal()
    await loadScript(scripts[0]!)
    const create = vi.fn()
    const actions = { order: { create } }

    rendered[0]!.options.createOrder(null, actions)
    let unit = create.mock.calls[0]![0].purchase_units[0]
    expect(unit.items[0]).toMatchObject({ category: 'DONATION', quantity: '1' })
    expect(unit.amount).toMatchObject({ currency_code: 'EUR', value: '25' })

    await type('12,50')
    rendered[0]!.options.createOrder(null, actions)
    unit = create.mock.calls[1]![0].purchase_units[0]
    expect(unit.amount.value).toBe('12.50')
    expect(unit.items[0].unit_amount.value).toBe('12.50')
  })

  it('subscribes monthly to the month plan with a whole quantity', async () => {
    await openPaypal()
    await loadScript(scripts[0]!)

    await click('Monthly', 'tab')
    expect(rendered[0]!.close).toHaveBeenCalled()
    expect(scripts).toHaveLength(2)
    const src = new URL(scripts[1]!.src)
    expect(src.searchParams.get('intent')).toBe('subscription')
    expect(src.searchParams.get('vault')).toBe('true')
    await loadScript(scripts[1]!)
    expect(rendered).toHaveLength(2)

    await type('12,60')
    const create = vi.fn()
    rendered[1]!.options.createSubscription(null, { subscription: { create } })
    expect(create).toHaveBeenCalledWith({ plan_id: 'P-2ND5083133959702RNK2375A', quantity: '13' })
  })

  it('thanks the donor once PayPal approves', async () => {
    await openPaypal()
    await loadScript(scripts[0]!)
    await act(async () => {
      await rendered[0]!.options.onApprove(null, { order: { capture: async () => ({}) } })
    })
    expect(screen.getByText('Thank you, your donation went through.')).toBeTruthy()
  })

  it('says so when the SDK cannot be loaded', async () => {
    await openPaypal()
    await act(async () => {
      scripts[0]!.onerror!(new Event('error'))
    })
    expect(screen.getByText(/PayPal cannot be reached right now/)).toBeTruthy()
  })
})
