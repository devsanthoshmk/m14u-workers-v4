import { useState, useRef, useEffect, useId } from 'react';
import { Search, ChevronDown, Check, X } from 'lucide-react';
import { LOCALE_OPTIONS } from '@/utils/constants';

export interface LanguageMultiSelectProps {
    id?: string;
    ariaLabelledby?: string;
    selected: string[];
    onChange: (languages: string[]) => void;
    className?: string;
}

export function LanguageMultiSelect({
    id: externalId,
    ariaLabelledby,
    selected,
    onChange,
    className = '',
}: LanguageMultiSelectProps) {
    const generatedId = useId();
    const id = externalId || generatedId;
    const listboxId = `${id}-listbox`;

    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(-1);

    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const optionsRef = useRef<Array<HTMLLabelElement | null>>([]);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isOpen]);

    // Handle Escape and general keyboard interaction
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!isOpen) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                setIsOpen(false);
                triggerRef.current?.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    // Focus search input when dropdown opens
    useEffect(() => {
        if (!isOpen) return;
        const timer = setTimeout(() => {
            searchInputRef.current?.focus();
        }, 30);
        return () => clearTimeout(timer);
    }, [isOpen]);

    const toggleLanguage = (val: string) => {
        if (selected.includes(val)) {
            onChange(selected.filter((item) => item !== val));
        } else {
            onChange([...selected, val]);
        }
    };

    const clearAll = () => {
        onChange([]);
    };

    const selectAllFiltered = () => {
        const combined = new Set([...selected, ...filteredOptions.map((o) => o.value)]);
        onChange(Array.from(combined));
    };

    const filteredOptions = LOCALE_OPTIONS.filter((option) =>
        option.label.toLowerCase().includes(searchTerm.trim().toLowerCase())
    );

    const selectedLabels = selected
        .map((val) => LOCALE_OPTIONS.find((opt) => opt.value === val)?.label)
        .filter(Boolean) as string[];

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filteredOptions.length > 0) {
                setHighlightedIndex(0);
                optionsRef.current[0]?.focus();
            }
        }
    };

    const handleOptionKeyDown = (e: React.KeyboardEvent<HTMLLabelElement>, index: number, value: string) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextIndex = index + 1 < filteredOptions.length ? index + 1 : 0;
            setHighlightedIndex(nextIndex);
            optionsRef.current[nextIndex]?.focus();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (index === 0) {
                setHighlightedIndex(-1);
                searchInputRef.current?.focus();
            } else {
                const prevIndex = index - 1;
                setHighlightedIndex(prevIndex);
                optionsRef.current[prevIndex]?.focus();
            }
        } else if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            toggleLanguage(value);
        }
    };

    return (
        <div ref={containerRef} className={`relative w-full ${className}`}>
            {/* Trigger Button */}
            <button
                ref={triggerRef}
                type="button"
                id={id}
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-controls={listboxId}
                aria-labelledby={ariaLabelledby}
                aria-label={!ariaLabelledby ? 'Listening languages' : undefined}
                onClick={() => setIsOpen((prev) => !prev)}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary"
            >
                <div className="flex flex-1 flex-wrap items-center gap-1.5 overflow-hidden">
                    {selected.length === 0 ? (
                        <span className="text-muted-foreground">All languages (no preference)</span>
                    ) : (
                        selectedLabels.map((label) => (
                            <span
                                key={label}
                                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
                            >
                                {label}
                                <span
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Remove ${label}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const opt = LOCALE_OPTIONS.find((o) => o.label === label);
                                        if (opt) toggleLanguage(opt.value);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            const opt = LOCALE_OPTIONS.find((o) => o.label === label);
                                            if (opt) toggleLanguage(opt.value);
                                        }
                                    }}
                                    className="cursor-pointer hover:opacity-75 focus:outline-none"
                                >
                                    <X className="size-3" />
                                </span>
                            </span>
                        ))
                    )}
                </div>
                <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 ${
                        isOpen ? 'rotate-180' : ''
                    }`}
                />
            </button>

            {/* Dropdown Panel */}
            {isOpen && (
                <div
                    className="absolute left-0 top-full z-50 mt-1.5 w-full rounded-2xl border border-border bg-card p-2 text-foreground shadow-2xl animate-fade-in"
                >
                    {/* Search Input */}
                    <div className="relative mb-2 px-1">
                        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <input
                            ref={searchInputRef}
                            type="search"
                            value={searchTerm}
                            onChange={(e) => {
                                setSearchTerm(e.target.value);
                                setHighlightedIndex(-1);
                            }}
                            onKeyDown={handleSearchKeyDown}
                            placeholder="Search languages…"
                            aria-label="Filter languages"
                            aria-controls={listboxId}
                            className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary [&::-webkit-search-cancel-button]:hidden"
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                onClick={() => {
                                    setSearchTerm('');
                                    setHighlightedIndex(-1);
                                    searchInputRef.current?.focus();
                                }}
                                aria-label="Clear search text"
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                <X className="size-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Quick Action Header */}
                    <div className="flex items-center justify-between border-b border-border/50 px-2 pb-1.5 text-[11px] text-muted-foreground">
                        <span>
                            {selected.length === 0
                                ? 'No preference'
                                : `${selected.length} selected`}
                        </span>
                        <div className="flex items-center gap-3">
                            {filteredOptions.length > 0 && (
                                <button
                                    type="button"
                                    onClick={selectAllFiltered}
                                    className="font-medium text-primary hover:underline"
                                >
                                    Select all
                                </button>
                            )}
                            {selected.length > 0 && (
                                <button
                                    type="button"
                                    onClick={clearAll}
                                    className="font-medium text-muted-foreground hover:text-foreground"
                                >
                                    Clear all
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Checkbox Options List */}
                    <div
                        id={listboxId}
                        role="listbox"
                        aria-multiselectable="true"
                        aria-label="Languages"
                        className="max-h-52 overflow-y-auto pt-1 scrollbar-thin"
                    >
                        {filteredOptions.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                No languages match “{searchTerm}”
                            </div>
                        ) : (
                            filteredOptions.map(({ label, value }, idx) => {
                                const isChecked = selected.includes(value);
                                const isHighlighted = highlightedIndex === idx;
                                return (
                                    <label
                                        key={value}
                                        ref={(el) => { optionsRef.current[idx] = el; }}
                                        role="option"
                                        aria-selected={isChecked}
                                        tabIndex={isHighlighted ? 0 : -1}
                                        onKeyDown={(e) => handleOptionKeyDown(e, idx, value)}
                                        className={`flex cursor-pointer items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors focus:outline-none focus:ring-1 focus:ring-primary ${
                                            isChecked
                                                ? 'bg-primary/10 text-primary font-semibold'
                                                : isHighlighted
                                                ? 'bg-surface text-foreground'
                                                : 'text-foreground hover:bg-surface'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={() => toggleLanguage(value)}
                                                tabIndex={-1}
                                                className="size-4 rounded border-border accent-primary focus:ring-primary"
                                            />
                                            <span>{label}</span>
                                        </div>
                                        {isChecked && <Check className="size-3.5 text-primary" />}
                                    </label>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export const LanguagePicker = LanguageMultiSelect;
