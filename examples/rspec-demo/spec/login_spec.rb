# frozen_string_literal: true

require 'pathname'

FIXTURES = Pathname.new(__dir__).parent.join('fixtures')

RSpec.describe 'Login' do
  Kensho::Feature('Authentication')
  Kensho::Epic('User onboarding')

  it 'lands on the home page after valid credentials',
     :critical,
     owner: 'alice',
     kensho_labels: { team: 'growth', surface: 'web' },
     kensho_links: [
       { kind: 'jira', url: 'https://jira.example.com/browse/PROJ-123', label: 'PROJ-123' }
     ] do
    puts 'about to call backend' # captured -> case.logs[]

    Kensho.step('open the login page') do
      Kensho.step('warm up CDN') do
        expect(1 + 1).to eq(2)
      end
    end

    Kensho.step('submit credentials') do
      Kensho.label('traffic', 'synthetic')
      expect('ok').to eq('ok')
    end

    Kensho.attach(FIXTURES.join('session.txt').to_s,
                  kind: 'text', name: 'session-dump.txt')
  end
end

RSpec.describe 'Cart' do
  Kensho::Feature('Cart')

  it 'totals correctly', :blocker do
    puts 'computing cart total'
    $stderr.write("warn: stale price cache\n")

    Kensho.step('load cart fixture') do
      @cart = { items: [{ price: 10 }, { price: 20 }] }
    end

    Kensho.step('verify total') do
      Kensho.attach(FIXTURES.join('broken-cart.png').to_s, kind: 'screenshot')
      # Intentional failure — sums to 30, not 40.
      expect(@cart[:items].map { |i| i[:price] }.sum).to eq(40)
    end
  end
end

RSpec.describe 'Promo codes' do
  it 'is gated by a feature flag', :minor, skip: 'feature not enabled in this environment' do
    expect(true).to be(true)
  end
end

RSpec.describe 'Search', :normal do
  Kensho::Feature('Search')

  [
    { query: 'widgets', expected_count: 3 },
    { query: 'gadgets', expected_count: 5 },
    { query: 'doodads', expected_count: 0 }
  ].each do |row|
    it "returns #{row[:expected_count]} results for #{row[:query].inspect}",
       kensho_labels: { query: row[:query] } do
      fake_db = { 'widgets' => 3, 'gadgets' => 5, 'doodads' => 0 }
      Kensho.step("query=#{row[:query].inspect}") do
        expect(fake_db[row[:query]]).to eq(row[:expected_count])
      end
    end
  end
end

RSpec.describe 'Profile' do
  Kensho::Feature('Profile')

  describe 'avatar' do
    it 'uploads', :normal do
      Kensho.step('pick avatar') {}
      Kensho.step('upload') {}
      expect(true).to be(true)
    end
  end

  describe 'email' do
    it 'updates the email', :trivial do
      Kensho.link('https://github.com/example/app/pull/42', kind: 'github', label: 'PR #42')
      Kensho.step('update email') {}
      expect(true).to be(true)
    end
  end
end

RSpec.describe 'Logs only' do
  it 'forwards captured output into case.logs[]', :normal do
    puts 'hello from stdout'
    puts 'more output'
    $stderr.write("uh oh from stderr\n")
    expect(true).to be(true)
  end
end

RSpec.describe 'Pending feature' do
  it 'is not implemented yet', :normal do
    pending 'still WIP'
    raise 'oops' # pending body must error to stay pending
  end
end
