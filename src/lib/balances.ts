import { Participant } from '@/generated/prisma/browser'
import { getGroupExpenses } from '@/lib/api'
import { match } from 'ts-pattern'

export type Balances = Record<
  Participant['id'],
  { paid: number; paidFor: number; total: number }
>

export type Reimbursement = {
  from: Participant['id']
  to: Participant['id']
  amount: number
}

/**
 * A small deterministic string hash (FNV-1a, 32 bit).
 *
 * Used to pick which participant is offered the remaining minor unit of an
 * uneven split. Seeding it with the expense id keeps `getBalances` a pure
 * function of the expenses — no persisted cursor, no randomness — while still
 * moving the extra unit to a different participant from one expense to the next.
 */
function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Splits `amount` (in minor units) over the given participants so that the
 * shares always add up to exactly `amount`.
 *
 * Every participant first gets the floor of their exact share; the units left
 * over are handed out by largest remainder (Hamilton apportionment). Even
 * splits produce identical remainders, so ties are broken by rotating the
 * starting position with `offset` — otherwise the same participants would
 * absorb the extra unit every single time.
 *
 * Returns the shares in the order the participants were passed in.
 */
function apportion(
  amount: number,
  shares: number[],
  totalShares: number,
  offset: number,
): number[] {
  const count = shares.length
  if (count === 0) return []
  // Shares are validated as positive on write, but legacy or directly written
  // rows are not guaranteed to be.
  if (totalShares === 0) return shares.map(() => 0)

  const amounts: number[] = []
  const remainders: { index: number; remainder: number }[] = []
  let distributed = 0

  shares.forEach((share, index) => {
    const exact = amount * share
    // Math.floor keeps the leftover non-negative for negative amounts (income)
    // just as it does for positive ones, so `remaining` below stays in [0, count).
    const base = Math.floor(exact / totalShares)
    amounts.push(base)
    distributed += base
    remainders.push({ index, remainder: exact - base * totalShares })
  })

  const remaining = amount - distributed
  if (remaining === 0) return amounts

  remainders.sort((a, b) => {
    if (a.remainder !== b.remainder) return b.remainder - a.remainder
    // Rotate the starting position so an even split does not always favour the
    // same participants.
    const rotate = (index: number) => (index - offset + count) % count
    return rotate(a.index) - rotate(b.index)
  })
  for (let i = 0; i < remaining; i++) {
    amounts[remainders[i].index] += 1
  }
  return amounts
}

export function getBalances(
  expenses: NonNullable<Awaited<ReturnType<typeof getGroupExpenses>>>,
): Balances {
  const balances: Balances = {}

  for (const expense of expenses) {
    const paidBy = expense.paidBy.id

    if (!balances[paidBy]) balances[paidBy] = { paid: 0, paidFor: 0, total: 0 }
    balances[paidBy].paid += expense.amount

    // `paidFor` is fetched without an `orderBy`, so the database is free to
    // return the rows in any order. Sort a copy by participant id so the split
    // does not depend on it.
    const paidFors = [...expense.paidFor].sort((a, b) =>
      a.participant.id < b.participant.id ? -1 : 1,
    )

    const shares = match(expense.splitMode)
      .with('EVENLY', () => paidFors.map(() => 1))
      .with('BY_SHARES', 'BY_PERCENTAGE', 'BY_AMOUNT', () =>
        paidFors.map(({ shares }) => shares),
      )
      .exhaustive()
    const totalShares = shares.reduce((sum, share) => sum + share, 0)

    // The expense may not carry an id yet (unsaved expenses, tests), in which
    // case the rotation simply starts at the first participant.
    const offset =
      expense.id && paidFors.length > 0
        ? hashString(expense.id) % paidFors.length
        : 0
    const dividedAmounts = apportion(
      expense.amount,
      shares,
      totalShares,
      offset,
    )

    paidFors.forEach((paidFor, index) => {
      if (!balances[paidFor.participant.id])
        balances[paidFor.participant.id] = { paid: 0, paidFor: 0, total: 0 }

      balances[paidFor.participant.id].paidFor += dividedAmounts[index]
    })
  }

  // Every share is apportioned as a whole minor unit, so the rounding below is
  // a no-op and only kept as a guard. It is what used to break the books: the
  // accumulated float totals were rounded per participant, which does not
  // preserve a sum, and the residue ended up in the group's total balance.
  for (const participantId in balances) {
    // add +0 to avoid negative zeros
    balances[participantId].paidFor =
      Math.round(balances[participantId].paidFor) + 0
    balances[participantId].paid = Math.round(balances[participantId].paid) + 0

    balances[participantId].total =
      balances[participantId].paid - balances[participantId].paidFor
  }
  return balances
}

export function getPublicBalances(reimbursements: Reimbursement[]): Balances {
  const balances: Balances = {}
  reimbursements.forEach((reimbursement) => {
    if (!balances[reimbursement.from])
      balances[reimbursement.from] = { paid: 0, paidFor: 0, total: 0 }

    if (!balances[reimbursement.to])
      balances[reimbursement.to] = { paid: 0, paidFor: 0, total: 0 }

    balances[reimbursement.from].paidFor += reimbursement.amount
    balances[reimbursement.from].total -= reimbursement.amount

    balances[reimbursement.to].paid += reimbursement.amount
    balances[reimbursement.to].total += reimbursement.amount
  })
  return balances
}

/**
 * A comparator that is stable across reimbursements.
 * This ensures that a participant executing a suggested reimbursement
 * does not result in completely new repayment suggestions.
 */
function compareBalancesForReimbursements(b1: any, b2: any): number {
  // positive balances come before negative balances
  if (b1.total > 0 && 0 > b2.total) {
    return -1
  } else if (b2.total > 0 && 0 > b1.total) {
    return 1
  }
  // if signs match, sort based on userid
  return b1.participantId < b2.participantId ? -1 : 1
}

export function getSuggestedReimbursements(
  balances: Balances,
): Reimbursement[] {
  const balancesArray = Object.entries(balances)
    .map(([participantId, { total }]) => ({ participantId, total }))
    .filter((b) => b.total !== 0)
  balancesArray.sort(compareBalancesForReimbursements)
  const reimbursements: Reimbursement[] = []
  while (balancesArray.length > 1) {
    const first = balancesArray[0]
    const last = balancesArray[balancesArray.length - 1]
    const amount = first.total + last.total
    if (first.total > -last.total) {
      reimbursements.push({
        from: last.participantId,
        to: first.participantId,
        amount: -last.total,
      })
      first.total = amount
      balancesArray.pop()
    } else {
      reimbursements.push({
        from: last.participantId,
        to: first.participantId,
        amount: first.total,
      })
      last.total = amount
      balancesArray.shift()
    }
  }
  return reimbursements.filter(({ amount }) => Math.round(amount) + 0 !== 0)
}
