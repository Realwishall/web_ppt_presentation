import { rolldown } from 'rolldown'
const b = await rolldown({ input: 'src/components/ContentPanel.jsx', external: (id) => !id.startsWith('.') && !id.startsWith('/'), jsx: 'react-jsx' })
await b.generate({ format: 'esm' })
console.log('BUILD PARSE OK')
