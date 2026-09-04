import { useEffect, useRef, useState, useCallback, type ChangeEvent } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Stage,
  Layer,
  Rect,
  Circle,
  Line,
  Text,
  Image as KonvaImage,
  Transformer,
} from 'react-konva'
import api, { getApiBase } from '../../utils/api'
import {
  ArrowLeftIcon,
  ArrowPathIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
  CheckIcon,
} from '@heroicons/react/24/outline'

type ElementType =
  | 'WALL'
  | 'DOOR'
  | 'STAIRS'
  | 'EMERGENCY_EXIT'
  | 'FIRE_EXTINGUISHER'
  | 'CAMERA'
  | 'ROOM'
  | 'PATH'
  | 'ASSEMBLY'

interface FloorElement {
  id: string
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  label?: string
  points?: number[]
}

interface Floor {
  id: string
  name: string
  floorNumber: number
  imageUrl?: string
  elements: FloorElement[]
}

const TOOL_META: { type: ElementType; label: string; color: string; hint: string }[] = [
  { type: 'WALL', label: 'Wall', color: '#1f2937', hint: 'Click-drag to draw wall' },
  { type: 'DOOR', label: 'Door', color: '#d97706', hint: 'Click to place door' },
  { type: 'ROOM', label: 'Room', color: '#3b82f6', hint: 'Click-drag room area' },
  { type: 'STAIRS', label: 'Stairs', color: '#6366f1', hint: 'Click to place stairs' },
  { type: 'EMERGENCY_EXIT', label: 'Exit', color: '#059669', hint: 'Click to place emergency exit' },
  { type: 'ASSEMBLY', label: 'Assembly', color: '#0d9488', hint: 'Click assembly point' },
  { type: 'FIRE_EXTINGUISHER', label: 'Extinguisher', color: '#dc2626', hint: 'Click to place' },
  { type: 'CAMERA', label: 'Camera', color: '#2563eb', hint: 'Click to place camera' },
  { type: 'PATH', label: 'Evac Path', color: '#f59e0b', hint: 'Click points, Finish Path to end' },
]

const CANVAS_W = 1000
const CANVAS_H = 700

function useBackgroundImage(url: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!url) {
      setImage(null)
      return
    }
    const img = new window.Image()
    img.onload = () => setImage(img)
    img.onerror = () => setImage(null)
    img.src = url
  }, [url])
  return image
}

function parseElements(raw: any[]): FloorElement[] {
  return (raw || []).map((el: any) => {
    let label = ''
    let points: number[] | undefined
    if (el.properties) {
      try {
        const p = JSON.parse(el.properties)
        label = p.label || ''
        points = p.points || undefined
      } catch { /* */ }
    }
    return {
      id: el.id,
      type: el.type,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      rotation: el.rotation || 0,
      label,
      points,
    }
  })
}

export default function FloorDesigner() {
  const { buildingId } = useParams()
  const [floors, setFloors] = useState<Floor[]>([])
  const [selectedFloor, setSelectedFloor] = useState<Floor | null>(null)
  const [selectedTool, setSelectedTool] = useState<ElementType>('WALL')
  const [elements, setElements] = useState<FloorElement[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null)
  const [preview, setPreview] = useState<FloorElement | null>(null)
  const [pathPoints, setPathPoints] = useState<number[]>([])
  const [bgDataUrl, setBgDataUrl] = useState<string | null>(null)
  const [labelEdit, setLabelEdit] = useState('')
  const [saving, setSaving] = useState(false)
  const [bannerMsg, setBannerMsg] = useState<{type: string; text: string} | null>(null)
  const [addingFloor, setAddingFloor] = useState(false)
  const [newFloorName, setNewFloorName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const stageRef = useRef<any>(null)
  const transformerRef = useRef<any>(null)
  const shapeRefs = useRef<Record<string, any>>({})

  const bgUrl =
  bgDataUrl ||
  (selectedFloor?.imageUrl
    ? selectedFloor.imageUrl.startsWith('http')
      ? selectedFloor.imageUrl
      : `${getApiBase()}${selectedFloor.imageUrl}`
    : null)
  const bgImage = useBackgroundImage(bgUrl)

  // Attach transformer to selected node
  useEffect(() => {
    const tr = transformerRef.current
    if (!tr) return
    if (!selectedId) {
      tr.nodes([])
      tr.getLayer()?.batchDraw()
      return
    }
    const el = elements.find((e) => e.id === selectedId)
    if (!el || el.type === 'PATH') {
      tr.nodes([])
      tr.getLayer()?.batchDraw()
      return
    }
    const node = shapeRefs.current[selectedId]
    if (node) {
      tr.nodes([node])
      tr.getLayer()?.batchDraw()
    }
  }, [selectedId, elements])

  useEffect(() => {
    if (buildingId) fetchFloors()
  }, [buildingId])

  const fetchFloors = async () => {
    try {
      const res = await api.get(`/floors/building/${buildingId}`)
      setFloors(res.data)
      if (res.data.length > 0) {
        const f =
          selectedFloor
            ? res.data.find((x: Floor) => x.id === selectedFloor.id) || res.data[0]
            : res.data[0]
        setSelectedFloor(f)
        setElements(parseElements(f.elements))
        // Only drop the staged local preview once the server actually has an
        // image for this floor — otherwise an unsaved upload would vanish.
        if (f.imageUrl) {
          setBgDataUrl(null)
          if (fileRef.current) fileRef.current.value = ''
        }
      }
    } catch (e) {
      console.error(e)
    }
  }

  const selectFloor = (id: string) => {
    const f = floors.find((x) => x.id === id)
    if (!f) return
    setSelectedFloor(f)
    setElements(parseElements(f.elements))
    setSelectedId(null)
    setPathPoints([])
    setBgDataUrl(null)
  }

  const createFloor = async () => {
    if (!newFloorName.trim() || !buildingId) return
    try {
      const maxNum = floors.reduce((m, f) => Math.max(m, f.floorNumber), 0)
      await api.post('/floors', {
        buildingId,
        name: newFloorName.trim(),
        floorNumber: maxNum + 1,
      })
      setAddingFloor(false)
      setNewFloorName('')
      fetchFloors()
    } catch {
      setBannerMsg({type:'error', text:'Failed to create floor'})
    }
  }

  const onImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setBgDataUrl(reader.result as string)
    reader.readAsDataURL(file)
  }

  // Uploads the file currently staged in the hidden input. The explicit
  // multipart header is REQUIRED with our axios instance: its default
  // `application/json` Content-Type would otherwise make axios serialize the
  // FormData to a JSON string, and multer then sees no file ("No image
  // uploaded"). Axios strips/repairs the missing boundary itself.
  const uploadPendingImage = async (file: File) => {
    if (!selectedFloor) throw new Error('No floor selected')
    const form = new FormData()
    form.append('image', file)
    const res = await api.post(`/floors/${selectedFloor.id}/image`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    setBgDataUrl(null)
    if (fileRef.current) fileRef.current.value = ''
    return res.data?.imageUrl as string | undefined
  }

  const uploadImageToServer = async () => {
    if (!selectedFloor || !fileRef.current?.files?.[0]) {
      setBannerMsg({type:'error', text:'Choose an image first'})
      return
    }
    try {
      await uploadPendingImage(fileRef.current.files[0])
      setBannerMsg({type:'success', text:'Floor plan image uploaded'})
      fetchFloors()
    } catch (e: any) {
      const detail = e?.response?.data?.error ? `: ${e.response.data.error}` : ''
      // Keep the local preview so the image doesn't vanish on failure.
      setBannerMsg({type:'error', text:`Image upload failed${detail} — your preview is kept, try again`})
    }
  }

  const getPointer = () => stageRef.current?.getPointerPosition() ?? null

  const handleMouseDown = (e: any) => {
    // ignore if clicked on a shape (selection handled by shape onClick)
    const clickedOnEmpty = e.target === e.target.getStage()
    if (!clickedOnEmpty) return

    setSelectedId(null)
    const pos = getPointer()
    if (!pos) return

    if (selectedTool === 'PATH') {
      setPathPoints((prev) => [...prev, pos.x, pos.y])
      return
    }

    if (selectedTool === 'WALL' || selectedTool === 'ROOM') {
      setDrawing(true)
      setDrawStart(pos)
      setPreview({
        id: 'preview',
        type: selectedTool,
        x: pos.x,
        y: pos.y,
        width: 0,
        height: selectedTool === 'WALL' ? 12 : 0,
      })
      return
    }

    const size =
      selectedTool === 'DOOR'
        ? { w: 48, h: 14 }
        : selectedTool === 'CAMERA'
          ? { w: 32, h: 32 }
          : selectedTool === 'FIRE_EXTINGUISHER'
            ? { w: 28, h: 28 }
            : selectedTool === 'EMERGENCY_EXIT'
              ? { w: 64, h: 32 }
              : selectedTool === 'ASSEMBLY'
                ? { w: 64, h: 64 }
                : { w: 56, h: 56 }

    const el: FloorElement = {
      id: `temp-${Date.now()}`,
      type: selectedTool,
      x: pos.x - size.w / 2,
      y: pos.y - size.h / 2,
      width: size.w,
      height: size.h,
      rotation: 0,
      label:
        selectedTool === 'EMERGENCY_EXIT'
          ? 'EXIT'
          : selectedTool === 'ASSEMBLY'
            ? 'Assembly'
            : selectedTool === 'CAMERA'
              ? 'Cam'
              : selectedTool === 'STAIRS'
                ? 'Stairs'
                : selectedTool === 'DOOR'
                  ? 'Door'
                  : '',
    }
    setElements((prev) => [...prev, el])
    setSelectedId(el.id)
    setLabelEdit(el.label || '')
  }

  const handleMouseMove = () => {
    if (!drawing || !drawStart) return
    const pos = getPointer()
    if (!pos) return
    const x = Math.min(drawStart.x, pos.x)
    const y = Math.min(drawStart.y, pos.y)
    let width = Math.abs(pos.x - drawStart.x)
    let height = Math.abs(pos.y - drawStart.y)
    if (selectedTool === 'WALL') {
      // snap to mostly horizontal or vertical
      if (width >= height) {
        height = Math.max(8, Math.min(height, 24))
        height = 12
      } else {
        width = 12
      }
    }
    setPreview({
      id: 'preview',
      type: selectedTool,
      x,
      y,
      width: Math.max(4, width),
      height: Math.max(4, height),
    })
  }

  const handleMouseUp = () => {
    if (!drawing || !preview) {
      setDrawing(false)
      setDrawStart(null)
      setPreview(null)
      return
    }
    if (preview.width > 6 && preview.height > 4) {
      const el: FloorElement = {
        ...preview,
        id: `temp-${Date.now()}`,
        label: selectedTool === 'ROOM' ? 'Room' : selectedTool === 'WALL' ? '' : '',
        rotation: 0,
      }
      setElements((prev) => [...prev, el])
      setSelectedId(el.id)
      setLabelEdit(el.label || '')
    }
    setDrawing(false)
    setDrawStart(null)
    setPreview(null)
  }

  const finishPath = () => {
    if (pathPoints.length >= 4) {
      const el: FloorElement = {
        id: `temp-${Date.now()}`,
        type: 'PATH',
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        points: [...pathPoints],
        label: 'Evacuation Route',
      }
      setElements((prev) => [...prev, el])
      setSelectedId(el.id)
      setLabelEdit(el.label || '')
    }
    setPathPoints([])
  }

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    setElements((prev) => prev.filter((e) => e.id !== selectedId))
    setSelectedId(null)
    setLabelEdit('')
  }, [selectedId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
      if (e.key === 'Escape') {
        setPathPoints([])
        setPreview(null)
        setDrawing(false)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteSelected])

  const updateLabel = (id: string, label: string) => {
    setLabelEdit(label)
    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, label } : e)))
  }

  const replaceType = (id: string, type: ElementType) => {
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e
        const next = { ...e, type }
        if (type === 'CAMERA' || type === 'FIRE_EXTINGUISHER') {
          next.width = Math.max(24, Math.min(e.width, 40))
          next.height = next.width
        }
        if (type === 'EMERGENCY_EXIT' && !next.label) next.label = 'EXIT'
        return next
      })
    )
  }

  const onTransformEnd = (id: string) => {
    const node = shapeRefs.current[id]
    if (!node) return
    const scaleX = node.scaleX()
    const scaleY = node.scaleY()
    node.scaleX(1)
    node.scaleY(1)
    setElements((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e
        const isCircle = e.type === 'CAMERA' || e.type === 'FIRE_EXTINGUISHER'
        if (isCircle) {
          const r = Math.max(10, (node.width() * scaleX) / 2)
          return {
            ...e,
            x: node.x() - r,
            y: node.y() - r,
            width: r * 2,
            height: r * 2,
            rotation: node.rotation(),
          }
        }
        return {
          ...e,
          x: node.x(),
          y: node.y(),
          width: Math.max(8, node.width() * scaleX),
          height: Math.max(8, node.height() * scaleY),
          rotation: node.rotation(),
        }
      })
    )
  }

  const onDragEnd = (id: string, e: any) => {
    const el = elements.find((x) => x.id === id)
    if (!el) return
    const isCircle = el.type === 'CAMERA' || el.type === 'FIRE_EXTINGUISHER'
    setElements((prev) =>
      prev.map((x) => {
        if (x.id !== id) return x
        if (isCircle) {
          return {
            ...x,
            x: e.target.x() - x.width / 2,
            y: e.target.y() - x.height / 2,
          }
        }
        return { ...x, x: e.target.x(), y: e.target.y() }
      })
    )
  }

  const saveFloor = async () => {
    if (!selectedFloor) return
    setSaving(true)
    try {
      // A staged background image lives only in memory — persist it first,
      // otherwise the refetch below would wipe the preview while the server
      // has nothing, making the image "vanish" on save.
      const pendingFile = fileRef.current?.files?.[0]
      if (pendingFile && bgDataUrl) {
        try {
          await uploadPendingImage(pendingFile)
        } catch (e: any) {
          const detail = e?.response?.data?.error ? `: ${e.response.data.error}` : ''
          setBannerMsg({type:'error', text:`Floor plan image upload failed${detail} — nothing was saved`})
          setSaving(false)
          return
        }
      }
      await api.put(`/floors/${selectedFloor.id}`, {
        elements: elements.map((el) => {
          const { id, label, points, ...rest } = el
          const props = JSON.stringify({ label: label || '', points: points || null })
          const base = { ...rest, properties: props, type: el.type, rotation: el.rotation || 0 }
          return id.startsWith('temp-') ? base : { ...base, id }
        }),
      })
      setBannerMsg({type:'success', text:'Floor plan saved'})
      fetchFloors()
    } catch (e: any) {
      const detail = e?.response?.data?.detail ? ` (${e.response.data.detail})` : ''
      setBannerMsg({type:'error', text:`Failed to save floor plan${detail}`})
    } finally {
      setSaving(false)
    }
  }

  const clearAll = () => {
    if (!confirm('Clear all elements on this floor?')) return
    setElements([])
    setSelectedId(null)
  }

  const selectedEl = elements.find((e) => e.id === selectedId)
  const toolHint = TOOL_META.find((t) => t.type === selectedTool)?.hint || ''

  const fillFor = (type: ElementType) => {
    switch (type) {
      case 'WALL':
        return '#1f2937'
      case 'DOOR':
        return '#d97706'
      case 'ROOM':
        return 'rgba(59,130,246,0.22)'
      case 'STAIRS':
        return '#6366f1'
      case 'EMERGENCY_EXIT':
        return '#059669'
      case 'ASSEMBLY':
        return 'rgba(13,148,136,0.4)'
      case 'CAMERA':
        return '#2563eb'
      case 'FIRE_EXTINGUISHER':
        return '#dc2626'
      default:
        return '#9ca3af'
    }
  }

  const registerRef = (id: string) => (node: any) => {
    if (node) shapeRefs.current[id] = node
    else delete shapeRefs.current[id]
  }

  const renderElement = (el: FloorElement, isPreview = false) => {
    const selected = !isPreview && selectedId === el.id

    if (el.type === 'PATH' && el.points && el.points.length >= 4) {
      return (
        <Line
          key={el.id}
          points={el.points}
          stroke="#f59e0b"
          strokeWidth={selected ? 6 : 4}
          dash={[12, 8]}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={20}
          onClick={(e) => {
            e.cancelBubble = true
            if (!isPreview) {
              setSelectedId(el.id)
              setLabelEdit(el.label || '')
            }
          }}
        />
      )
    }

    if (el.type === 'CAMERA' || el.type === 'FIRE_EXTINGUISHER') {
      const r = el.width / 2
      return (
        <Circle
          key={el.id}
          ref={isPreview ? undefined : registerRef(el.id)}
          x={el.x + r}
          y={el.y + r}
          radius={r}
          fill={fillFor(el.type)}
          stroke={selected ? '#2563eb' : undefined}
          strokeWidth={selected ? 3 : 0}
          draggable={!isPreview}
          rotation={el.rotation || 0}
          onClick={(e) => {
            e.cancelBubble = true
            if (!isPreview) {
              setSelectedId(el.id)
              setLabelEdit(el.label || '')
            }
          }}
          onDragEnd={(e) => !isPreview && onDragEnd(el.id, e)}
          onTransformEnd={() => !isPreview && onTransformEnd(el.id)}
        />
      )
    }

    return (
      <Rect
        key={el.id}
        ref={isPreview ? undefined : registerRef(el.id)}
        x={el.x}
        y={el.y}
        width={el.width}
        height={el.height}
        fill={fillFor(el.type)}
        stroke={
          selected
            ? '#2563eb'
            : el.type === 'ROOM' || el.type === 'ASSEMBLY'
              ? '#3b82f6'
              : undefined
        }
        strokeWidth={selected ? 3 : el.type === 'ROOM' || el.type === 'ASSEMBLY' ? 2 : 0}
        cornerRadius={el.type === 'EMERGENCY_EXIT' || el.type === 'ASSEMBLY' ? 6 : 0}
        draggable={!isPreview}
        rotation={el.rotation || 0}
        onClick={(e) => {
          e.cancelBubble = true
          if (!isPreview) {
            setSelectedId(el.id)
            setLabelEdit(el.label || '')
          }
        }}
        onDragEnd={(e) => !isPreview && onDragEnd(el.id, e)}
        onTransformEnd={() => !isPreview && onTransformEnd(el.id)}
      />
    )
  }

  return (
    <div className="h-[calc(100vh-5rem)] flex flex-col gap-3">
      {bannerMsg && (
        <div className={`p-3 rounded-lg text-sm border ${bannerMsg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-800'}`}>
          {bannerMsg.text}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/manager/buildings" className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeftIcon className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Floor Plan Designer</h1>
            <p className="text-sm text-gray-500">
              Draw · select · drag blue handles to resize · change type in Properties
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input w-40"
            value={selectedFloor?.id || ''}
            onChange={(e) => selectFloor(e.target.value)}
          >
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setAddingFloor(true)}
            className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1"
          >
            <PlusIcon className="w-4 h-4" /> Floor
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 flex items-center gap-1"
          >
            <PhotoIcon className="w-4 h-4" /> Upload Plan
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onImageUpload} />
          {bgDataUrl && (
            <button onClick={uploadImageToServer} className="px-3 py-2 border rounded-lg text-sm text-blue-600">
              Save Image
            </button>
          )}
          <button
            onClick={clearAll}
            className="px-3 py-2 border rounded-lg text-sm text-red-600 hover:bg-red-50 flex items-center gap-1"
          >
            <ArrowPathIcon className="w-4 h-4" /> Clear
          </button>
          <button onClick={saveFloor} disabled={saving} className="btn-primary flex items-center gap-2 text-sm">
            <CheckIcon className="w-4 h-4" />
            {saving ? 'Saving…' : 'Save Plan'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-3 min-h-0">
        <div className="w-36 bg-white border rounded-xl p-2 flex flex-col gap-1 overflow-y-auto">
          <p className="text-xs font-semibold text-gray-500 px-2 py-1">TOOLS</p>
          {TOOL_META.map((t) => (
            <button
              key={t.type}
              onClick={() => {
                setSelectedTool(t.type)
                if (t.type !== 'PATH') setPathPoints([])
              }}
              className={`flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm ${
                selectedTool === t.type ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-gray-50 text-gray-700'
              }`}
            >
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: t.color }} />
              {t.label}
            </button>
          ))}
          <div className="border-t my-2" />
          <button
            onClick={deleteSelected}
            disabled={!selectedId}
            className="flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
          >
            <TrashIcon className="w-4 h-4" /> Delete
          </button>
          {selectedTool === 'PATH' && pathPoints.length >= 4 && (
            <button onClick={finishPath} className="mt-1 btn-primary text-xs py-1.5">
              Finish Path
            </button>
          )}
          <p className="text-[11px] text-gray-400 px-2 mt-2 leading-snug">{toolHint}</p>
          <p className="text-[11px] text-gray-400 px-2">Select object → drag corners to resize</p>
        </div>

        <div className="flex-1 bg-white border rounded-xl overflow-auto relative">
          <Stage
            width={CANVAS_W}
            height={CANVAS_H}
            ref={stageRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className="floor-canvas cursor-crosshair"
          >
            <Layer>
              {bgImage && (
                <KonvaImage image={bgImage} x={0} y={0} width={CANVAS_W} height={CANVAS_H} opacity={0.5} listening={false} />
              )}
              {Array.from({ length: Math.ceil(CANVAS_W / 25) }).map((_, i) => (
                <Line key={`vg${i}`} points={[i * 25, 0, i * 25, CANVAS_H]} stroke="#e5e7eb" strokeWidth={0.5} listening={false} />
              ))}
              {Array.from({ length: Math.ceil(CANVAS_H / 25) }).map((_, i) => (
                <Line key={`hg${i}`} points={[0, i * 25, CANVAS_W, i * 25]} stroke="#e5e7eb" strokeWidth={0.5} listening={false} />
              ))}

              {elements.map((el) => renderElement(el))}
              {preview && renderElement(preview, true)}

              {/* labels on top */}
              {elements.map((el) =>
                el.label && el.type !== 'PATH' ? (
                  <Text
                    key={`${el.id}-label`}
                    x={el.x}
                    y={el.type === 'WALL' ? el.y - 16 : el.y + el.height / 2 - 6}
                    width={Math.max(el.width, 70)}
                    text={el.label}
                    fontSize={11}
                    fontStyle="bold"
                    fill={el.type === 'EMERGENCY_EXIT' ? '#fff' : '#111827'}
                    align="center"
                    listening={false}
                  />
                ) : null
              )}

              {pathPoints.length >= 2 && (
                <Line points={pathPoints} stroke="#f59e0b" strokeWidth={3} dash={[10, 6]} listening={false} />
              )}
              {pathPoints.length >= 2 &&
                Array.from({ length: pathPoints.length / 2 }).map((_, i) => (
                  <Circle
                    key={`pp${i}`}
                    x={pathPoints[i * 2]}
                    y={pathPoints[i * 2 + 1]}
                    radius={4}
                    fill="#f59e0b"
                    listening={false}
                  />
                ))}

              <Transformer
                ref={transformerRef}
                rotateEnabled
                enabledAnchors={[
                  'top-left',
                  'top-right',
                  'bottom-left',
                  'bottom-right',
                  'middle-left',
                  'middle-right',
                  'top-center',
                  'bottom-center',
                ]}
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < 8 || newBox.height < 8) return oldBox
                  return newBox
                }}
              />
            </Layer>
          </Stage>
        </div>

        <div className="w-60 bg-white border rounded-xl p-4 overflow-y-auto">
          <h3 className="font-semibold text-gray-900 mb-3">Properties</h3>
          {selectedEl ? (
            <div className="space-y-3 text-sm">
              <div>
                <label className="label">Type (replace)</label>
                <select
                  className="input text-sm"
                  value={selectedEl.type}
                  onChange={(e) => replaceType(selectedEl.id, e.target.value as ElementType)}
                  disabled={selectedEl.type === 'PATH'}
                >
                  {TOOL_META.filter((t) => t.type !== 'PATH').map((t) => (
                    <option key={t.type} value={t.type}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Label</label>
                <input
                  className="input text-sm"
                  value={labelEdit}
                  onChange={(e) => updateLabel(selectedEl.id, e.target.value)}
                  placeholder="e.g. Exit A"
                />
              </div>
              <div>
                <label className="label">Position</label>
                <p className="text-gray-600">
                  X: {Math.round(selectedEl.x)} · Y: {Math.round(selectedEl.y)}
                </p>
              </div>
              {selectedEl.width > 0 && (
                <div>
                  <label className="label">Size</label>
                  <p className="text-gray-600">
                    {Math.round(selectedEl.width)} × {Math.round(selectedEl.height)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Drag the blue corner handles on the canvas to resize</p>
                </div>
              )}
              <div>
                <label className="label">Rotation</label>
                <p className="text-gray-600">{Math.round(selectedEl.rotation || 0)}°</p>
              </div>
              <button onClick={deleteSelected} className="w-full mt-2 px-3 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50">
                Delete object
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Click an object to select it. Then drag it, use blue handles to resize, or change its type here.
            </p>
          )}

          <div className="border-t mt-4 pt-4">
            <h4 className="font-medium text-sm mb-2">Elements ({elements.length})</h4>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {elements.map((el) => (
                <button
                  key={el.id}
                  onClick={() => {
                    setSelectedId(el.id)
                    setLabelEdit(el.label || '')
                  }}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded ${
                    selectedId === el.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-600'
                  }`}
                >
                  {el.label || el.type.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {addingFloor && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h2 className="font-semibold text-lg mb-4">Add Floor</h2>
            <input
              className="input mb-4"
              placeholder="e.g. Floor 6"
              value={newFloorName}
              onChange={(e) => setNewFloorName(e.target.value)}
            />
            <div className="flex gap-2">
              <button onClick={() => setAddingFloor(false)} className="flex-1 px-4 py-2 border rounded-lg">
                Cancel
              </button>
              <button onClick={createFloor} className="flex-1 btn-primary">
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
