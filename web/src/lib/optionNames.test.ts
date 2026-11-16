import { describe, expect, it } from 'vitest'

import { de, en, type TranslationKey } from './i18n.data'
import { optionLabel } from './optionNames'

const english = (key: TranslationKey) => en[key]
const german = (key: TranslationKey) => de[key]

describe('the name of an rclone option', () => {
  it('is written out in full words', () => {
    expect(optionLabel('auth_url', english)).toBe('Authentication URL')
    expect(optionLabel('bearer_token', english)).toBe('Bearer token')
    expect(optionLabel('pacer_min_sleep', english)).toBe('Minimum pause between requests')
  })

  it('reads in the language of the app', () => {
    expect(optionLabel('pacer_min_sleep', german)).toBe('Kürzeste Pause zwischen Anfragen')
  })

  it('follows the backend where one option means something else there', () => {
    expect(optionLabel('provider', english, 's3')).toBe('Provider')
    expect(optionLabel('provider', english, 'storj')).toBe('Sign-in method')
    expect(optionLabel('concurrency', english, 'sftp')).toBe('Outstanding requests per file')
    expect(optionLabel('concurrency', english, 'ftp')).toBe('Simultaneous connections')
  })

  it('falls back to its rclone name when the table has none', () => {
    expect(optionLabel('brand_new_option', english)).toBe('brand_new_option')
  })
})
