import { getGroupExpenses } from '@/lib/api'
import { getBalances, getSuggestedReimbursements } from './balances'

type Expenses = NonNullable<Awaited<ReturnType<typeof getGroupExpenses>>>
type Expense = Expenses[number]

function expense(
  paidBy: string,
  amount: number,
  paidFor: string[],
  isReimbursement = false,
): Expense {
  return {
    amount,
    isReimbursement,
    splitMode: 'EVENLY',
    paidBy: { id: paidBy, name: paidBy },
    paidFor: paidFor.map((id) => ({
      participant: { id, name: id },
      shares: 100,
    })),
  } as Expense
}

describe('getBalances', () => {
  it('splits an expense evenly between the participants', () => {
    const balances = getBalances([expense('alice', 3000, ['alice', 'bob'])])

    expect(balances.alice).toEqual({ paid: 3000, paidFor: 1500, total: 1500 })
    expect(balances.bob).toEqual({ paid: 0, paidFor: 1500, total: -1500 })
  })

  it('counts a reimbursement like any other expense', () => {
    const balances = getBalances([
      expense('alice', 3000, ['alice', 'bob']),
      expense('bob', 1500, ['alice'], true),
    ])

    expect(balances.alice.total).toBe(0)
    expect(balances.bob.total).toBe(0)
  })
})

describe('settling up', () => {
  /**
   * Repayments are recorded in the group currency, so booking a suggested reimbursement
   * must bring every balance to exactly zero — including when the expense was originally
   * entered in another currency and converted.
   */
  it('brings every balance to zero once the suggestions are booked', () => {
    const expenses = [
      expense('alice', 500000, ['alice', 'bob', 'carol']),
      expense('bob', 12345, ['alice', 'bob', 'carol']),
      expense('carol', 999, ['alice', 'bob']),
    ]

    const reimbursements = getSuggestedReimbursements(getBalances(expenses))
    expect(reimbursements.length).toBeGreaterThan(0)

    const settled = [
      ...expenses,
      ...reimbursements.map(({ from, to, amount }) =>
        expense(from, amount, [to], true),
      ),
    ]

    for (const balance of Object.values(getBalances(settled))) {
      expect(balance.total).toBe(0)
    }
  })

  it('leaves no further reimbursement to suggest', () => {
    const expenses = [expense('alice', 7777, ['alice', 'bob'])]
    const reimbursements = getSuggestedReimbursements(getBalances(expenses))

    const settled = [
      ...expenses,
      ...reimbursements.map(({ from, to, amount }) =>
        expense(from, amount, [to], true),
      ),
    ]

    expect(getSuggestedReimbursements(getBalances(settled))).toEqual([])
  })
})
