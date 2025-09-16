// Panel.tsx – trechos para adicionar campos de pagamento
// 1) Estado inicial do formulário:
const [form, setForm] = useState({
  estabelecimento: "",
  emissao: new Date().toISOString().slice(0, 16),
  total: "",
  mtp: "dinheiro",
  pagamento_tipo: "avista",      // 'avista' | 'parcelado'
  pagamento_parcelas: 1,         // >= 1
});

// 2) Efeito para normalizar quando o MTP mudar:
useEffect(() => {
  setForm((f) => {
    if (f.mtp !== "credito") {
      return { ...f, pagamento_tipo: "avista", pagamento_parcelas: 1 };
    }
    if (f.pagamento_tipo !== "avista" && f.pagamento_tipo !== "parcelado") {
      return { ...f, pagamento_tipo: "avista" };
    }
    return f;
  });
}, [form.mtp]);

// 3) JSX depois do seletor de MTP:
{form.mtp === "credito" && (
  <>
    <div className="flex flex-col gap-1">
      <label>Pagamento</label>
      <select
        className="input"
        value={form.pagamento_tipo}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            pagamento_tipo: e.target.value,
            pagamento_parcelas:
              e.target.value === "parcelado"
                ? Math.max(1, Number(f.pagamento_parcelas || 1))
                : 1,
          }))
        }
      >
        <option value="avista">à vista</option>
        <option value="parcelado">parcelado</option>
      </select>
    </div>

    {form.pagamento_tipo === "parcelado" && (
      <div className="flex flex-col gap-1">
        <label>Parcelas</label>
        <input
          type="number"
          min={1}
          step={1}
          className="input"
          value={form.pagamento_parcelas}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              pagamento_parcelas: Math.max(1, Number(e.target.value || 1)),
            }))
          }
        />
      </div>
    )}
  </>
)}

// 4) Antes do fetch/submit, monte o payload:
const payload = {
  estabelecimento: form.estabelecimento || null,
  emissao: form.emissao,
  total: Number(form.total || 0),
  mtp: form.mtp,
  ...(form.mtp === "credito"
    ? {
        pagamento_tipo: form.pagamento_tipo,
        pagamento_parcelas:
          form.pagamento_tipo === "parcelado"
            ? Math.max(1, Number(form.pagamento_parcelas || 1))
            : 1,
      }
    : { pagamento_tipo: "avista", pagamento_parcelas: 1 }),
};
