*** Settings ***
Documentation    Kensho Robot Demo
Library          OperatingSystem
Library          Collections
Library          KenshoLib.py

Force Tags       @demo


*** Test Cases ***
Login Happy Path
    [Documentation]    Sign in with valid credentials lands the user on /home.
    [Tags]    @critical    @feature:Authentication    @epic:User onboarding
    ...       @owner:alice    @label:team=growth
    ...       @link:jira=https://jira.example.com/browse/PROJ-123=PROJ-123
    Open Login Page
    Submit Credentials    demo    demo
    Verify Redirected To Home
    Attach Session Dump

Cart Total Is Wrong
    [Documentation]    Failing test — should map to status='fail'.
    [Tags]    @blocker    @feature:Cart
    Load Cart Fixture
    Verify Total    expected=40

Promo Codes Skipped
    [Tags]    @minor
    Skip    feature not enabled in this environment

Search Returns Expected Count
    [Documentation]    Data-driven test: every row becomes a Kensho parameter row.
    [Tags]    @normal    @feature:Search
    [Template]    Verify Search
    widgets    3
    gadgets    5
    doodads    0

Logs Only
    [Tags]    @trivial
    Log    hello from log
    Log    something to inspect


*** Keywords ***
Open Login Page
    Log    opening login page
    Sleep    1ms

Submit Credentials
    [Arguments]    ${user}    ${pwd}
    Log    submitting ${user}
    Sleep    1ms

Verify Redirected To Home
    Log    landed on /home
    Should Be Equal    ok    ok

Attach Session Dump
    ${root}=    Get Demo Fixtures Dir
    Attach Fixture    ${root}/session.txt    text    session-dump.txt

Load Cart Fixture
    Log    loading cart fixture

Verify Total
    [Arguments]    ${expected}=40
    # Intentional failure: the cart sums to 30, not the expected ${expected}.
    Should Be Equal As Integers    30    ${expected}    cart total mismatch

Verify Search
    [Arguments]    ${query}    ${expected}
    Log    searching for ${query}
    ${db}=    Create Dictionary    widgets=3    gadgets=5    doodads=0
    ${got}=    Get From Dictionary    ${db}    ${query}
    Should Be Equal As Integers    ${got}    ${expected}
