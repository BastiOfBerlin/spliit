'use client'
import { CategoryIcon } from '@/app/groups/[groupId]/expenses/category-icon'
import {
  StatBar,
  StatBarListSkeleton,
} from '@/app/groups/[groupId]/stats/stat-bar'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Currency } from '@/lib/currency'
import { CategorySpending } from '@/lib/totals'
import { formatCurrency, formatDateOnly } from '@/lib/utils'
import { trpc } from '@/trpc/client'
import { ChevronRight } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState } from 'react'

type Props = {
  groupId: string
  categories?: CategorySpending[]
  currency?: Currency
  from?: string
  to?: string
}

export function CategoryBreakdown({
  groupId,
  categories,
  currency,
  from,
  to,
}: Props) {
  const t = useTranslations('Stats.ByCategory')

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {!categories || !currency ? (
          <StatBarListSkeleton />
        ) : categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <CategoryBars
            groupId={groupId}
            categories={categories}
            currency={currency}
            from={from}
            to={to}
          />
        )}
      </CardContent>
    </Card>
  )
}

function CategoryBars({
  groupId,
  categories,
  currency,
  from,
  to,
}: {
  groupId: string
  categories: CategorySpending[]
  currency: Currency
  from?: string
  to?: string
}) {
  const locale = useLocale()
  const t = useTranslations('Categories')
  const tByCategory = useTranslations('Stats.ByCategory')
  const [selected, setSelected] = useState<CategorySpending | null>(null)
  const total = categories.reduce((sum, category) => sum + category.total, 0)
  const max = Math.max(...categories.map((category) => category.total))

  return (
    <>
      <div className="flex flex-col gap-4">
        {categories.map((category, index) => {
          const share =
            total > 0 ? Math.round((category.total / total) * 100) : 0
          return (
            <button
              key={category.categoryId}
              type="button"
              onClick={() => setSelected(category)}
              className="flex w-full flex-col gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={tByCategory('showExpenses', {
                category: t(`${category.grouping}.${category.name}`),
              })}
            >
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  <CategoryIcon
                    category={{
                      id: category.categoryId,
                      grouping: category.grouping,
                      name: category.name,
                    }}
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate">
                    {t(`${category.grouping}.${category.name}`)}
                  </span>
                </div>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatCurrency(currency, category.total, locale)} ({share}%)
                </span>
              </div>
              <StatBar
                value={category.total}
                max={max}
                color={`hsl(var(--chart-${(index % 5) + 1}))`}
              />
            </button>
          )
        })}
      </div>

      <CategoryExpensesDialog
        groupId={groupId}
        category={selected}
        currency={currency}
        from={from}
        to={to}
        onClose={() => setSelected(null)}
      />
    </>
  )
}

function CategoryExpensesDialog({
  groupId,
  category,
  currency,
  from,
  to,
  onClose,
}: {
  groupId: string
  category: CategorySpending | null
  currency: Currency
  from?: string
  to?: string
  onClose: () => void
}) {
  const locale = useLocale()
  const t = useTranslations('Stats.ByCategory')
  const tCategories = useTranslations('Categories')

  const { data, isLoading } = trpc.groups.stats.categoryExpenses.useQuery(
    {
      groupId,
      categoryId: category?.categoryId ?? 0,
      from,
      to,
    },
    { enabled: category !== null },
  )

  const expenses = data?.expenses

  return (
    <Dialog open={category !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] gap-0 overflow-hidden p-0">
        {category && (
          <>
            <DialogHeader className="space-y-1.5 border-b p-6">
              <DialogTitle className="flex items-center gap-2">
                <CategoryIcon
                  category={{
                    id: category.categoryId,
                    grouping: category.grouping,
                    name: category.name,
                  }}
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                />
                {tCategories(`${category.grouping}.${category.name}`)}
              </DialogTitle>
              <DialogDescription>{t('detailsDescription')}</DialogDescription>
            </DialogHeader>
            <div className="overflow-y-auto">
              {isLoading || !expenses ? (
                <div className="flex flex-col gap-3 p-6">
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-5 w-full" />
                  ))}
                </div>
              ) : expenses.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">
                  {t('detailsEmpty')}
                </p>
              ) : (
                <ul className="divide-y">
                  {expenses.map((expense) => (
                    <li key={expense.id}>
                      <Link
                        href={`/groups/${groupId}/expenses/${expense.id}/edit`}
                        className="flex items-center justify-between gap-2 px-6 py-3 text-sm hover:bg-accent"
                      >
                        <div className="min-w-0">
                          <div className="truncate">{expense.title}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatDateOnly(expense.expenseDate, locale, {
                              dateStyle: 'medium',
                            })}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="font-bold tabular-nums">
                            {formatCurrency(currency, expense.amount, locale)}
                          </span>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
