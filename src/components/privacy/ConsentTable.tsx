interface ConsentTableProps {
  title: string
  columns: readonly string[]
  rows: readonly (readonly string[])[]
}

export function ConsentTable({ title, columns, rows }: ConsentTableProps) {
  return <section className="min-w-0 space-y-2">
    <h3 className="text-sm font-semibold text-[#202124]">{title}</h3>
    <div className="space-y-3 sm:hidden">
      {rows.map((row, index) => <dl key={index} className="space-y-2 rounded-xl border border-[#DADCE0] p-3 text-sm">
        {columns.map((column, cellIndex) => <div key={column}>
          <dt className="font-semibold text-[#202124]">{column}</dt>
          <dd className="mt-0.5 whitespace-pre-wrap break-words text-[#5F6368]">{row[cellIndex]}</dd>
        </div>)}
      </dl>)}
    </div>
    <div className="hidden overflow-x-auto rounded-xl border border-[#DADCE0] sm:block">
      <table className="w-full border-collapse text-left text-sm [word-break:keep-all]">
        <caption className="sr-only">{title}</caption>
        <thead className="bg-[#F1F3F4] text-[#202124]">
          <tr>{columns.map(column => <th key={column} scope="col" className="border-b border-[#DADCE0] px-3 py-2 font-semibold whitespace-nowrap">{column}</th>)}</tr>
        </thead>
        <tbody>{rows.map((row, index) => <tr key={index} className="border-b border-[#E8EAED] last:border-0">
          {columns.map((column, cellIndex) => <td key={column} className="px-3 py-2 align-top whitespace-pre-wrap text-[#5F6368]">{row[cellIndex]}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </section>
}
