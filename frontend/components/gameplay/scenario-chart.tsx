'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Script from 'next/script'
import { type OHLCVCandle } from '@/lib/data/lehman-ohlcv'

declare global {
    interface Window {
        LightweightCharts: any
    }
}

interface Props {
    data: OHLCVCandle[]
    currentCandleIndex: number
    criticalMomentVisible: boolean
}

export function ScenarioChart({ data, currentCandleIndex, criticalMomentVisible }: Props) {
    const containerRef = useRef<HTMLDivElement>(null)
    const chartRef = useRef<any>(null)
    const candleSeriesRef = useRef<any>(null)
    const volumeSeriesRef = useRef<any>(null)
    const [libReady, setLibReady] = useState(false)
    const [activeRange, setActiveRange] = useState<'1m' | '1D' | '1W' | '1M'>('1M')

    const visibleData = data.slice(0, currentCandleIndex + 1)
    const currentCandle = visibleData[visibleData.length - 1]

    // ─── Build chart when library + container are ready ────
    const initChart = useCallback(() => {
        if (!containerRef.current || !window.LightweightCharts || chartRef.current) return
        const LWC = window.LightweightCharts

        const chart = LWC.createChart(containerRef.current, {
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
            layout: {
                background: { type: 'solid', color: '#080b0e' },
                textColor: '#374151',
                fontSize: 11,
                fontFamily: 'Inter, -apple-system, sans-serif',
            },
            grid: {
                vertLines: { color: '#0f1820' },
                horzLines: { color: '#0f1820' },
            },
            crosshair: {
                mode: 1,
                vertLine: { color: 'rgba(255,255,255,0.2)', labelBackgroundColor: '#1c2635' },
                horzLine: { color: 'rgba(255,255,255,0.2)', labelBackgroundColor: '#1c2635' },
            },
            rightPriceScale: {
                borderColor: '#1c2635',
                scaleMargins: { top: 0.05, bottom: 0.2 },
            },
            timeScale: {
                borderColor: '#1c2635',
                rightOffset: 3,
                barSpacing: 6,
                minBarSpacing: 1,
                timeVisible: false,
                fixLeftEdge: true,
                fixRightEdge: false,
            },
            handleScroll: true,
            handleScale: true,
        })

        chartRef.current = chart

        const candleSeries = chart.addCandlestickSeries({
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
            priceLineVisible: true,
            priceLineColor: '#ef5350',
            priceLineWidth: 1,
            priceLineStyle: 2,
            lastValueVisible: true,
        })
        candleSeriesRef.current = candleSeries

        const volumeSeries = chart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
        })
        chart.priceScale('volume').applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        })
        volumeSeriesRef.current = volumeSeries

        // Initial data
        updateChartData(visibleData, candleSeries, volumeSeries)
        // Enforce thin candles — do NOT use fitContent as it auto-scales width
        chart.timeScale().applyOptions({ barSpacing: 6 })
        chart.timeScale().scrollToRealTime()
    }, [data])

    function updateChartData(
        slicedData: OHLCVCandle[],
        candleSeries: any,
        volumeSeries: any
    ) {
        const candleData = slicedData.map(c => ({
            time: c.date,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
        }))
        candleSeries.setData(candleData)

        const volumeData = slicedData.map(c => ({
            time: c.date,
            value: c.volume * 1_000_000,
            color: c.close >= c.open
                ? 'rgba(38,166,154,0.5)'
                : 'rgba(239,83,80,0.5)',
        }))
        volumeSeries.setData(volumeData)
    }

    // ─── Update data when currentCandleIndex changes ────
    useEffect(() => {
        if (candleSeriesRef.current && volumeSeriesRef.current) {
            updateChartData(visibleData, candleSeriesRef.current, volumeSeriesRef.current)
            // Enforce fixed thin bar spacing and scroll to latest
            if (chartRef.current) {
                chartRef.current.timeScale().applyOptions({ barSpacing: 6 })
                chartRef.current.timeScale().scrollToRealTime()
            }
        }
    }, [currentCandleIndex])

    // ─── Handle library ready ────
    useEffect(() => {
        if (libReady) initChart()
    }, [libReady, initChart])

    // ─── Library already loaded check ────
    useEffect(() => {
        if (window.LightweightCharts) setLibReady(true)
    }, [])

    // ─── Resize handler ────
    useEffect(() => {
        const handleResize = () => {
            if (chartRef.current && containerRef.current) {
                chartRef.current.applyOptions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight,
                })
            }
        }
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    return (
        <>
            <Script
                src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"
                strategy="afterInteractive"
                onLoad={() => setLibReady(true)}
            />

            <div className="relative w-full h-full" style={{ backgroundColor: '#080b0e' }}>
                {/* Chart container */}
                <div ref={containerRef} className="w-full h-full" />

                {/* ─── Floating OHLCV header (top-left) ──── */}
                {currentCandle && (
                    <div
                        className="absolute top-0 left-0 z-10 pointer-events-none flex items-center gap-4"
                        style={{ padding: '8px 16px', fontFamily: 'monospace', fontSize: '12px' }}
                    >
                        <div className="flex items-center gap-2">
                            <span
                                className="text-[11px] font-extrabold px-2 py-0.5 rounded"
                                style={{ backgroundColor: '#dc2626', color: 'white', letterSpacing: '0.04em' }}
                            >
                                LEH
                            </span>
                            <span className="text-[11px]" style={{ color: '#64748b' }}>July – Sept 2008</span>
                        </div>
                        <div className="flex items-center gap-3 text-[12px]">
                            <span>
                                <span style={{ color: '#94a3b8' }}>O </span>
                                <span style={{ color: '#e2e8f0' }}>{currentCandle.open.toFixed(2)}</span>
                            </span>
                            <span>
                                <span style={{ color: '#94a3b8' }}>H </span>
                                <span style={{ color: '#22c55e' }}>{currentCandle.high.toFixed(2)}</span>
                            </span>
                            <span>
                                <span style={{ color: '#94a3b8' }}>L </span>
                                <span style={{ color: '#ef4444' }}>{currentCandle.low.toFixed(2)}</span>
                            </span>
                            <span>
                                <span style={{ color: '#94a3b8' }}>C </span>
                                <span style={{ color: currentCandle.close >= currentCandle.open ? '#22c55e' : '#ef4444' }}>
                                    {currentCandle.close.toFixed(2)}
                                </span>
                            </span>
                            <span>
                                <span style={{ color: '#94a3b8' }}>V </span>
                                <span style={{ color: '#94a3b8' }}>{currentCandle.volume.toFixed(1)}M</span>
                            </span>
                        </div>
                    </div>
                )}

                {/* ─── Timeframe buttons (top-right) ──── */}
                <div className="absolute top-2 right-3 z-10 flex items-center gap-1">
                    {(['1m', '1D', '1W', '1M'] as const).map((range) => (
                        <button
                            key={range}
                            onClick={() => setActiveRange(range)}
                            className="transition-all duration-150"
                            style={{
                                padding: '4px 10px',
                                borderRadius: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                cursor: 'pointer',
                                backgroundColor: activeRange === range ? '#1c2635' : 'transparent',
                                color: activeRange === range ? '#fff' : '#475569',
                                border: 'none',
                            }}
                        >
                            {range}
                        </button>
                    ))}
                </div>

                {/* ─── CRITICAL MOMENT tooltip ──── */}
                {criticalMomentVisible && (
                    <div
                        className="absolute z-20"
                        style={{
                            top: '15%',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            animation: 'valueFlash 0.3s ease-out',
                        }}
                    >
                        <div
                            style={{
                                background: '#1a0d0d',
                                border: '1px solid rgba(239,68,68,0.4)',
                                borderRadius: '10px',
                                padding: '10px 14px',
                                boxShadow: '0 4px 20px rgba(239,68,68,0.2)',
                                maxWidth: '220px',
                            }}
                        >
                            <p style={{ fontSize: '10px', fontWeight: 800, color: '#ef4444', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px' }}>
                                CRITICAL MOMENT
                            </p>
                            <p style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.5 }}>
                                Lehman Brothers files for bankruptcy — the largest in US history. Stock collapses to near zero.
                            </p>
                        </div>
                        {/* Connector line */}
                        <div style={{
                            width: '1px',
                            height: '30px',
                            borderLeft: '1px dashed rgba(239,68,68,0.4)',
                            margin: '0 auto',
                        }} />
                    </div>
                )}

                {/* ─── Red flash overlay ──── */}
                {criticalMomentVisible && (
                    <div
                        className="absolute inset-0 pointer-events-none z-5"
                        style={{
                            border: '2px solid rgba(239,68,68,0.5)',
                            borderRadius: '0',
                            animation: 'valueFlash 0.5s ease-out',
                        }}
                    />
                )}
            </div>
        </>
    )
}
