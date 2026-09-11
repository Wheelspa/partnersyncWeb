'use client'

import { useState } from 'react'
import { Shield, Sparkles, Upload, FileText, X, Check, CheckCircle2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast, Toaster } from 'sonner'

const MAX_FILE_MB = 5
const MAX_FILES = 5

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result.split(',')[1] || '')
    r.onerror = reject
    r.readAsDataURL(file)
  })

const VendorPortal = () => {
  const [form, setForm] = useState({
    vendorName: '', vendorEmail: '', vendorPhone: '',
    title: '', amount: '', notes: '',
  })
  const [files, setFiles] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(null)

  const onFilesPicked = async (fileList) => {
    const picked = Array.from(fileList || [])
    for (const f of picked) {
      if (files.length + 1 > MAX_FILES) { toast.error(`Max ${MAX_FILES} files`); break }
      if (f.size > MAX_FILE_MB * 1024 * 1024) { toast.error(`${f.name} exceeds ${MAX_FILE_MB}MB`); continue }
      try {
        const data = await fileToBase64(f)
        setFiles(prev => [...prev, { name: f.name, type: f.type, size: f.size, data }])
      } catch {
        toast.error(`Failed to read ${f.name}`)
      }
    }
  }

  const removeFile = (i) => setFiles(files.filter((_, idx) => idx !== i))

  const submit = async () => {
    if (!form.vendorName || !form.title || !form.amount) {
      return toast.error('Vendor name, title, and amount are required')
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/vendor/quotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, files }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setSuccess(data)
      toast.success('Quotation submitted successfully')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setForm({ vendorName: '', vendorEmail: '', vendorPhone: '', title: '', amount: '', notes: '' })
    setFiles([])
    setSuccess(null)
  }

  if (success) {
    return (
      <div className="min-h-screen dark-panel text-neutral-100 flex items-center justify-center p-6">
        <Toaster position="top-right" richColors />
        <div className="max-w-lg w-full rounded-2xl bg-neutral-950/80 border border-amber-400/30 backdrop-blur-xl p-10 text-center">
          <div className="h-16 w-16 rounded-full gold-gradient grid place-items-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-neutral-900" />
          </div>
          <h1 className="font-display text-3xl font-bold">Quotation Received</h1>
          <p className="text-neutral-400 mt-3">
            Thank you, <b className="text-amber-300">{success.vendorName}</b>. Your quotation has been received and routed to the approval queue.
          </p>
          <div className="mt-6 rounded-lg border border-amber-400/20 bg-amber-400/5 p-4 text-left">
            <div className="text-xs uppercase tracking-wider text-amber-300 mb-2">Confirmation</div>
            <div className="text-sm space-y-1">
              <div><span className="text-neutral-400">Reference:</span> <span className="font-mono text-xs">{success.id}</span></div>
              <div><span className="text-neutral-400">Title:</span> {success.title}</div>
              <div><span className="text-neutral-400">Amount:</span> ₹{Number(success.amount).toLocaleString('en-IN')}</div>
              <div><span className="text-neutral-400">Files:</span> {success.files?.length || 0} attached</div>
            </div>
          </div>
          <div className="mt-6 flex gap-2 justify-center">
            <Button onClick={reset} className="gold-gradient text-neutral-900 font-semibold">Submit Another</Button>
          </div>
          <p className="text-[11px] text-neutral-500 mt-6">A partner will contact you at {form.vendorEmail || 'the email on file'} once the review is complete.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen dark-panel text-neutral-100 p-6 relative overflow-hidden">
      <Toaster position="top-right" richColors />
      <div className="absolute inset-0 opacity-30 pointer-events-none"
        style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(212,175,55,0.25), transparent 45%), radial-gradient(circle at 80% 60%, rgba(212,175,55,0.15), transparent 45%)' }} />
      <div className="max-w-4xl mx-auto relative">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-11 w-11 rounded-lg gold-gradient grid place-items-center text-neutral-900">
            <Shield className="h-6 w-6" />
          </div>
          <div>
            <div className="font-display text-2xl font-bold">PartnerSync</div>
            <div className="text-xs text-neutral-400 uppercase tracking-wider">Vendor Submission Portal</div>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-400/30 bg-amber-400/5 mb-4">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs font-medium text-amber-200">Secure Submission</span>
            </div>
            <h1 className="font-display text-4xl font-bold leading-tight">
              Submit your <span className="gold-text">quotation</span>
            </h1>
            <p className="mt-4 text-neutral-300">
              Send us your proposal with all supporting documents. It will be routed directly to the appropriate partner for review.
            </p>
            <div className="mt-6 space-y-2 text-sm text-neutral-400">
              <div className="flex items-start gap-2"><Check className="h-4 w-4 text-amber-400 mt-0.5" /> No account needed</div>
              <div className="flex items-start gap-2"><Check className="h-4 w-4 text-amber-400 mt-0.5" /> Attach PDFs, images (max {MAX_FILES} files, {MAX_FILE_MB}MB each)</div>
              <div className="flex items-start gap-2"><Check className="h-4 w-4 text-amber-400 mt-0.5" /> Every submission is audit-logged</div>
              <div className="flex items-start gap-2"><Check className="h-4 w-4 text-amber-400 mt-0.5" /> You will be contacted once reviewed</div>
            </div>
          </div>

          <div className="md:col-span-2 rounded-2xl bg-neutral-950/80 border border-amber-400/20 backdrop-blur-xl p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="text-xs text-neutral-400">Your Company / Vendor Name <span className="text-rose-400">*</span></label>
                <Input value={form.vendorName} onChange={e => setForm({ ...form, vendorName: e.target.value })}
                  placeholder="Acme Industries Pvt Ltd" className="mt-1 bg-neutral-900 border-neutral-800 text-neutral-100" />
              </div>
              <div>
                <label className="text-xs text-neutral-400">Contact Email</label>
                <Input type="email" value={form.vendorEmail} onChange={e => setForm({ ...form, vendorEmail: e.target.value })}
                  placeholder="sales@vendor.com" className="mt-1 bg-neutral-900 border-neutral-800 text-neutral-100" />
              </div>
              <div>
                <label className="text-xs text-neutral-400">Contact Phone</label>
                <Input value={form.vendorPhone} onChange={e => setForm({ ...form, vendorPhone: e.target.value })}
                  placeholder="+91 98xxxxxxxx" className="mt-1 bg-neutral-900 border-neutral-800 text-neutral-100" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-neutral-400">Quotation Title <span className="text-rose-400">*</span></label>
                <Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Annual Steel Beam Supply Contract" className="mt-1 bg-neutral-900 border-neutral-800 text-neutral-100" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-neutral-400">Total Amount (₹) <span className="text-rose-400">*</span></label>
                <Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
                  placeholder="500000" className="mt-1 bg-neutral-900 border-neutral-800 text-neutral-100" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-neutral-400">Notes / Scope Summary</label>
                <Textarea rows={4} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  placeholder="Deliverables, timelines, payment terms, warranties…"
                  className="mt-1 bg-neutral-900 border-neutral-800 text-neutral-100" />
              </div>

              <div className="md:col-span-2">
                <label className="text-xs text-neutral-400 mb-2 block">Supporting Documents</label>
                <label className="block cursor-pointer rounded-lg border-2 border-dashed border-amber-400/30 bg-amber-400/5 hover:bg-amber-400/10 transition p-6 text-center">
                  <input type="file" multiple accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
                    className="hidden" onChange={e => onFilesPicked(e.target.files)} />
                  <Upload className="h-6 w-6 mx-auto text-amber-400 mb-1" />
                  <div className="text-sm font-medium text-neutral-200">Click to upload or drag files here</div>
                  <div className="text-xs text-neutral-500 mt-1">PDF, images, spreadsheets · max {MAX_FILE_MB}MB each</div>
                </label>
                {files.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {files.map((f, i) => (
                      <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border border-neutral-800 bg-neutral-900">
                        <FileText className="h-4 w-4 text-amber-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{f.name}</div>
                          <div className="text-[10px] text-neutral-500">{(f.size / 1024).toFixed(1)} KB · {f.type || 'file'}</div>
                        </div>
                        <button onClick={() => removeFile(i)} className="text-neutral-500 hover:text-rose-400">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Button onClick={submit} disabled={submitting}
              className="mt-6 w-full gold-gradient text-neutral-900 hover:opacity-90 font-semibold">
              <Send className="h-4 w-4 mr-1.5" />
              {submitting ? 'Submitting…' : 'Submit Quotation'}
            </Button>
            <p className="text-[11px] text-neutral-500 mt-3 text-center">
              By submitting you confirm the information is accurate. Your submission is recorded in an immutable audit trail.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VendorPortal
