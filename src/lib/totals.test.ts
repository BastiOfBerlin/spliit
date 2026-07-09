import {
  filterExpensesByDateRange,
  getExpensesByCategory,
  getRecurringSpending,
  getSpendingByCategory,
  getSpendingByParticipant,
  getSpendingOverTime,
  getSpendingSummary,
} from './totals'

type Expense = Parameters<typeof getSpendingByCategory>[0][number]

function makeExpense(partial: Partial<Expense>): Expense {
  return {
    id: 'expense',
    title: 'Expense',
    amount: 0,
    category: null,
    isReimbursement: false,
    splitMode: 'EVENLY',
    expenseDate: new Date('2024-01-01T00:00:00Z'),
    paidBy: { id: 'alice', name: 'Alice' },
    paidFor: [],
    ...partial,
  } as unknown as Expense
}

const groceries = { id: 1, grouping: 'Food and Drink', name: 'Groceries' }
const transport = { id: 2, grouping: 'Transportation', name: 'Car' }

describe('getSpendingByCategory', () => {
  it('aggregates by category, ignores reimbursements and sorts by total', () => {
    const result = getSpendingByCategory([
      makeExpense({ amount: 1000, category: groceries }),
      makeExpense({ amount: 500, category: groceries }),
      makeExpense({ amount: 3000, category: transport }),
      makeExpense({ amount: 9999, category: transport, isReimbursement: true }),
    ])

    expect(result).toEqual([
      { categoryId: 2, grouping: 'Transportation', name: 'Car', total: 3000 },
      {
        categoryId: 1,
        grouping: 'Food and Drink',
        name: 'Groceries',
        total: 1500,
      },
    ])
  })

  it('treats a missing category as Uncategorized/General', () => {
    const result = getSpendingByCategory([
      makeExpense({ amount: 200, category: null }),
    ])
    expect(result).toEqual([
      {
        categoryId: 0,
        grouping: 'Uncategorized',
        name: 'General',
        total: 200,
      },
    ])
  })
})

describe('getExpensesByCategory', () => {
  it('returns only the matching category, excludes reimbursements and sorts newest first', () => {
    const older = makeExpense({
      id: 'a',
      amount: 1000,
      category: groceries,
      expenseDate: new Date('2024-01-10T00:00:00Z'),
    })
    const newer = makeExpense({
      id: 'b',
      amount: 500,
      category: groceries,
      expenseDate: new Date('2024-02-20T00:00:00Z'),
    })
    const otherCategory = makeExpense({
      id: 'c',
      amount: 3000,
      category: transport,
      expenseDate: new Date('2024-03-01T00:00:00Z'),
    })
    const reimbursement = makeExpense({
      id: 'd',
      amount: 9999,
      category: groceries,
      isReimbursement: true,
      expenseDate: new Date('2024-04-01T00:00:00Z'),
    })

    const result = getExpensesByCategory(
      [older, newer, otherCategory, reimbursement],
      groceries.id,
    )

    expect(result.map((expense) => expense.id)).toEqual(['b', 'a'])
  })

  it('matches expenses without a category against the Uncategorized id (0)', () => {
    const uncategorized = makeExpense({ id: 'a', amount: 200, category: null })
    const categorized = makeExpense({
      id: 'b',
      amount: 300,
      category: groceries,
    })

    const result = getExpensesByCategory([uncategorized, categorized], 0)

    expect(result.map((expense) => expense.id)).toEqual(['a'])
  })
})

describe('getSpendingByParticipant', () => {
  it('computes paid and share per participant, sorted by amount paid', () => {
    const participants = [
      { id: 'alice', name: 'Alice' },
      { id: 'bob', name: 'Bob' },
    ]
    const expenses = [
      makeExpense({
        amount: 1000,
        paidBy: { id: 'alice', name: 'Alice' },
        paidFor: [
          { participant: { id: 'alice', name: 'Alice' }, shares: 1 },
          { participant: { id: 'bob', name: 'Bob' }, shares: 1 },
        ],
      }),
    ]

    const result = getSpendingByParticipant(participants, expenses)

    expect(result).toEqual([
      {
        participantId: 'alice',
        name: 'Alice',
        paid: 1000,
        paidCount: 1,
        share: 500,
      },
      { participantId: 'bob', name: 'Bob', paid: 0, paidCount: 0, share: 500 },
    ])
  })
})

describe('getRecurringSpending', () => {
  it('summarizes active recurring expenses per period', () => {
    const result = getRecurringSpending([
      { amount: 1000, recurrenceRule: 'MONTHLY', isReimbursement: false },
      { amount: 500, recurrenceRule: 'MONTHLY', isReimbursement: false },
      { amount: 700, recurrenceRule: 'WEEKLY', isReimbursement: false },
      { amount: 100, recurrenceRule: 'DAILY', isReimbursement: false },
      { amount: 999, recurrenceRule: 'NONE', isReimbursement: false },
      { amount: 999, recurrenceRule: 'MONTHLY', isReimbursement: true },
    ])

    expect(result.count).toBe(4)
    expect(result.byPeriod).toEqual([
      { period: 'DAILY', count: 1, total: 100 },
      { period: 'WEEKLY', count: 1, total: 700 },
      { period: 'MONTHLY', count: 2, total: 1500 },
    ])
    const expectedMonthly = Math.round(
      100 * (365.25 / 12) + 700 * (365.25 / 12 / 7) + 1500,
    )
    expect(result.estimatedMonthly).toBe(expectedMonthly)
    // Yearly is computed independently from the monthly figure (not × 12) so it
    // does not compound the monthly rounding.
    const expectedYearly = Math.round(
      100 * 365.25 + 700 * (365.25 / 7) + 1500 * 12,
    )
    expect(result.estimatedYearly).toBe(expectedYearly)
  })

  it('returns an empty summary when there are no recurring expenses', () => {
    const result = getRecurringSpending([
      { amount: 1000, recurrenceRule: 'NONE', isReimbursement: false },
    ])
    expect(result.count).toBe(0)
    expect(result.byPeriod).toEqual([])
    expect(result.estimatedMonthly).toBe(0)
    expect(result.estimatedYearly).toBe(0)
  })
})

describe('filterExpensesByDateRange', () => {
  const expenses = [
    { expenseDate: new Date('2026-01-15T00:00:00Z') },
    { expenseDate: new Date('2026-02-10T00:00:00Z') },
    { expenseDate: new Date('2026-03-20T00:00:00Z') },
  ]

  it('returns everything when no bounds are given', () => {
    expect(filterExpensesByDateRange(expenses)).toHaveLength(3)
  })

  it('filters inclusively on both bounds', () => {
    const result = filterExpensesByDateRange(
      expenses,
      '2026-02-01',
      '2026-02-28',
    )
    expect(result).toHaveLength(1)
    expect(result[0].expenseDate.toISOString().slice(0, 10)).toBe('2026-02-10')
  })

  it('supports an open-ended lower bound', () => {
    expect(filterExpensesByDateRange(expenses, '2026-02-10')).toHaveLength(2)
  })
})

describe('getSpendingOverTime', () => {
  it('buckets by month and fills the gaps between first and last', () => {
    const result = getSpendingOverTime([
      makeExpense({
        amount: 1000,
        expenseDate: new Date('2026-01-15T00:00:00Z'),
      }),
      makeExpense({
        amount: 500,
        expenseDate: new Date('2026-01-20T00:00:00Z'),
      }),
      makeExpense({
        amount: 9999,
        expenseDate: new Date('2026-01-05T00:00:00Z'),
        isReimbursement: true,
      }),
      makeExpense({
        amount: 300,
        expenseDate: new Date('2026-03-01T00:00:00Z'),
      }),
    ])

    expect(result).toEqual([
      { month: '2026-01', total: 1500 },
      { month: '2026-02', total: 0 },
      { month: '2026-03', total: 300 },
    ])
  })

  it('returns an empty array when there are no expenses', () => {
    expect(getSpendingOverTime([])).toEqual([])
  })
})

describe('getSpendingSummary', () => {
  it('computes count, average, largest expense and active span', () => {
    const result = getSpendingSummary([
      makeExpense({
        amount: 1000,
        title: 'Hotel',
        expenseDate: new Date('2026-01-15T00:00:00Z'),
      }),
      makeExpense({
        amount: 500,
        title: 'Lunch',
        expenseDate: new Date('2026-01-10T00:00:00Z'),
      }),
      makeExpense({
        amount: 99999,
        title: 'Refund',
        expenseDate: new Date('2026-01-20T00:00:00Z'),
        isReimbursement: true,
      }),
    ])

    expect(result).toEqual({
      expenseCount: 2,
      totalSpending: 1500,
      averageExpense: 750,
      largestExpense: { title: 'Hotel', amount: 1000 },
      firstDate: '2026-01-10',
      lastDate: '2026-01-15',
    })
  })

  it('returns a zeroed summary with no expenses', () => {
    expect(getSpendingSummary([])).toEqual({
      expenseCount: 0,
      totalSpending: 0,
      averageExpense: 0,
      largestExpense: null,
      firstDate: null,
      lastDate: null,
    })
  })
})
